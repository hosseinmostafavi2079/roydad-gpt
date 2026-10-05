import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DomainError } from "@/shared/errors/domain-error";
import { hashPlatformPassword } from "@/infrastructure/auth/password";
import { sendTenantInvitationEmail } from "@/infrastructure/auth/mailer";
import {
  getTenantPool,
  type TenantPoolContext,
} from "@/infrastructure/db/tenant/pool";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { assertCanGrantPermissions } from "@/modules/tenant-identity/permissions";
import { authorize } from "@/modules/tenant-identity/permissions";
import {
  assertOwnerRoleGrantsPreserved,
  assertRoleIsMutable,
  isTenantInvitationAcceptable,
  isTenantInvitationToken,
  isTenantActorBoundTo,
  tenantStatusPermission,
} from "@/modules/tenant-identity/policy";

type TenantAuditRecord = Readonly<{
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string;
  beforeState?: unknown;
  afterState?: unknown;
}>;
type TenantInvitationContext = TenantPoolContext &
  Pick<TenantContext, "hostname" | "branding"> &
  Partial<Pick<TenantContext, "features">>;

function assertActorTenant(
  context: TenantPoolContext,
  actor: TenantActor,
): void {
  if (!isTenantActorBoundTo(actor.tenantId, context.tenantId)) {
    throw new DomainError("UNAUTHENTICATED", "Sign-in is required.");
  }
}

async function audit(
  client: PoolClient,
  record: TenantAuditRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO tenant_audit_logs
       (tenant_id, actor_id, action, target_type, target_id, request_id, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      record.tenantId,
      record.actorId,
      record.action,
      record.targetType,
      record.targetId,
      record.requestId,
      record.beforeState === undefined
        ? null
        : JSON.stringify(record.beforeState),
      record.afterState === undefined
        ? null
        : JSON.stringify(record.afterState),
    ],
  );
}

async function transaction<T>(
  context: TenantPoolContext,
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getTenantPool(context).connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function issueInvitation(
  context: TenantInvitationContext,
  input: Readonly<{
    name: string;
    email: string;
    roleCodes: string[];
    profileType?: "STAFF" | "INSTRUCTOR" | "PARTICIPANT" | undefined;
    title?: string | undefined;
    displayName?: string | undefined;
  }>,
  actor: TenantActor | null,
  requestId: string,
  origin: string,
  replacePending = false,
): Promise<{ userId: string }> {
  if (actor) assertActorTenant(context, actor);
  const profileType = input.profileType ?? "STAFF";
  if (profileType !== "STAFF" && !context.features?.crm) {
    throw new DomainError(
      "FEATURE_DISABLED",
      "This feature is not enabled for the tenant.",
    );
  }
  if (actor) {
    authorize(
      actor.permissions,
      {
        STAFF: "staff.create",
        INSTRUCTOR: "instructor.create",
        PARTICIPANT: "participant.create",
      }[profileType],
    );
  }
  const cleanEmail = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const userId = await transaction(context, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`tenant-invitation:${context.tenantId}:${cleanEmail}`],
    );
    const roles = await client.query<{
      id: string;
      code: string;
      permission_key: string | null;
    }>(
      `SELECT role.id, role.code, role_permission.permission_key
       FROM tenant_roles AS role
       LEFT JOIN tenant_role_permissions AS role_permission
         ON role_permission.tenant_id = role.tenant_id AND role_permission.role_id = role.id
       WHERE role.tenant_id = $1 AND role.code = ANY($2::varchar[])
       ORDER BY role.code, role_permission.permission_key FOR SHARE OF role`,
      [context.tenantId, input.roleCodes],
    );
    const foundCodes = new Set(roles.rows.map((role) => role.code));
    if (foundCodes.size !== input.roleCodes.length) {
      throw new DomainError("VALIDATION_FAILED", "Choose valid tenant roles.");
    }
    const granted = new Set(
      roles.rows.flatMap((role) =>
        role.permission_key ? [role.permission_key] : [],
      ),
    );
    if (actor) assertCanGrantPermissions(actor.permissions, granted);
    const existing = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM tenant_users
       WHERE "tenantId" = $1 AND email = $2 FOR UPDATE`,
      [context.tenantId, cleanEmail],
    );
    let id = existing.rows[0]?.id;
    if (existing.rows[0] && existing.rows[0].status !== "INVITED") {
      throw new DomainError(
        "CONFLICT",
        "An active tenant account already uses this email.",
      );
    }
    if (id) {
      const pending = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM tenant_invitations
           WHERE tenant_id = $1 AND user_id = $2 AND consumed_at IS NULL
             AND revoked_at IS NULL AND expires_at > now()
         ) AS exists`,
        [context.tenantId, id],
      );
      if (pending.rows[0]?.exists && !replacePending) {
        throw new DomainError(
          "CONFLICT",
          "A pending invitation already exists for this account.",
        );
      }
      await client.query(
        `UPDATE tenant_users SET name = $3, status = 'INVITED', "emailVerified" = false,
           "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = now()
         WHERE "tenantId" = $1 AND id = $2`,
        [context.tenantId, id, input.name],
      );
      await client.query(
        `UPDATE tenant_invitations SET revoked_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [context.tenantId, id],
      );
      await client.query(
        "DELETE FROM tenant_user_roles WHERE tenant_id = $1 AND user_id = $2",
        [context.tenantId, id],
      );
    } else {
      id = randomUUID();
      await client.query(
        `INSERT INTO tenant_users (id, "tenantId", name, email, status)
         VALUES ($1, $2, $3, $4, 'INVITED')`,
        [id, context.tenantId, input.name, cleanEmail],
      );
    }
    for (const role of [...foundCodes].sort()) {
      await client.query(
        `INSERT INTO tenant_user_roles (tenant_id, user_id, role_id, assigned_by)
         SELECT $1, $2, id, $3 FROM tenant_roles WHERE tenant_id = $1 AND code = $4
         ON CONFLICT DO NOTHING`,
        [context.tenantId, id, actor?.id ?? null, role],
      );
    }
    if (profileType === "STAFF") {
      await client.query(
        `INSERT INTO tenant_staff_profiles (tenant_id, user_id, title)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
        [context.tenantId, id, input.title ?? null],
      );
    } else if (profileType === "INSTRUCTOR") {
      await client.query(
        `INSERT INTO tenant_instructor_profiles (tenant_id, user_id, display_name)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
        [context.tenantId, id, input.displayName ?? input.name],
      );
    } else {
      await client.query(
        `INSERT INTO tenant_participant_profiles (tenant_id, user_id, display_name)
         VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()`,
        [context.tenantId, id, input.displayName ?? input.name],
      );
    }
    await client.query(
      `INSERT INTO tenant_invitations (tenant_id, user_id, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours')`,
      [context.tenantId, id, hash, actor?.id ?? null],
    );
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor?.id ?? null,
      action:
        actor && profileType === "STAFF"
          ? "staff.invited"
          : actor && profileType === "INSTRUCTOR"
            ? "instructor.invited"
            : actor && profileType === "PARTICIPANT"
              ? "participant.invited"
              : "tenant_owner.invited",
      targetType: "TENANT_USER",
      targetId: id,
      requestId,
      afterState: {
        roleCodes: [...foundCodes].sort(),
        profileType,
        emailHash: createHash("sha256")
          .update(cleanEmail)
          .digest("hex")
          .slice(0, 16),
      },
    });
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor?.id ?? null,
      action: "tenant_invitation.created",
      targetType: "TENANT_USER",
      targetId: id,
      requestId,
      afterState: {
        expiresInHours: 24,
        profileType,
        roleCodes: [...foundCodes].sort(),
      },
    });
    return id;
  });
  const link = new URL("/accept-invitation", origin);
  link.searchParams.set("token", token);
  await sendTenantInvitationEmail({
    email: cleanEmail,
    tenantName: context.branding.brandName,
    inviteUrl: link.toString(),
  });
  return { userId };
}

export function issueTenantUserInvitation(
  context: TenantInvitationContext,
  input: Parameters<typeof issueInvitation>[1],
  actor: TenantActor,
  requestId: string,
  origin: string,
) {
  return issueInvitation(context, input, actor, requestId, origin);
}

export function issueInitialTenantOwnerInvitation(
  context: TenantInvitationContext,
  input: Readonly<{ name: string; email: string }>,
  requestId: string,
  origin: string,
  allowExistingInvite = false,
) {
  return (async () => {
    const lock = await getTenantPool(context).connect();
    const lockName = `tenant-owner-bootstrap:${context.tenantId}`;
    try {
      await lock.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        lockName,
      ]);
      const existing = await lock.query<{
        id: string;
        email: string;
        status: string;
      }>(
        `SELECT account.id, account.email, account.status
         FROM tenant_user_roles AS user_role
         JOIN tenant_roles AS role ON role.tenant_id = user_role.tenant_id AND role.id = user_role.role_id
         JOIN tenant_users AS account ON account.id = user_role.user_id AND account."tenantId" = user_role.tenant_id
         WHERE user_role.tenant_id = $1 AND role.code = 'organization_owner'
         ORDER BY account.id FOR UPDATE OF account`,
        [context.tenantId],
      );
      if (existing.rowCount) {
        const owner = existing.rows[0];
        if (
          !allowExistingInvite ||
          existing.rowCount !== 1 ||
          owner?.email !== input.email.toLowerCase()
        ) {
          throw new DomainError(
            "CONFLICT",
            "An organization owner is already assigned.",
          );
        }
        if (owner.status === "ACTIVE")
          return { userId: owner.id, invitationIssued: false };
        if (owner.status !== "INVITED") {
          throw new DomainError(
            "CONFLICT",
            "The initial organization owner is unavailable.",
          );
        }
      }
      const result = await issueInvitation(
        context,
        { ...input, roleCodes: ["organization_owner"], profileType: "STAFF" },
        null,
        requestId,
        origin,
        allowExistingInvite,
      );
      return { ...result, invitationIssued: true };
    } finally {
      await lock
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName])
        .catch(() => undefined);
      lock.release();
    }
  })();
}

export async function acceptTenantInvitation(
  context: TenantContext,
  token: string,
  password: string,
  requestId: string,
): Promise<void> {
  if (!isTenantInvitationToken(token)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The invitation is invalid or expired.",
    );
  }
  const hash = tokenHash(token);
  const preliminary = await getTenantPool(context).query<{
    status: string;
    expires_at: Date;
    consumed_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT account.status, invitation.expires_at, invitation.consumed_at, invitation.revoked_at
     FROM tenant_invitations AS invitation
     JOIN tenant_users AS account ON account.id = invitation.user_id AND account."tenantId" = invitation.tenant_id
     WHERE invitation.tenant_id = $1 AND invitation.token_hash = $2`,
    [context.tenantId, hash],
  );
  if (
    !preliminary.rows[0] ||
    !isTenantInvitationAcceptable({
      status: preliminary.rows[0].status,
      expiresAt: preliminary.rows[0].expires_at,
      consumedAt: preliminary.rows[0].consumed_at,
      revokedAt: preliminary.rows[0].revoked_at,
    })
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The invitation is invalid or expired.",
    );
  }
  const passwordHash = await hashPlatformPassword(password);
  await transaction(context, async (client) => {
    const found = await client.query<{
      invitation_id: string;
      user_id: string;
      status: string;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT invitation.id AS invitation_id, invitation.user_id, account.status,
              invitation.expires_at, invitation.consumed_at, invitation.revoked_at
       FROM tenant_invitations AS invitation
       JOIN tenant_users AS account ON account.id = invitation.user_id AND account."tenantId" = invitation.tenant_id
       WHERE invitation.tenant_id = $1 AND invitation.token_hash = $2
       FOR UPDATE OF invitation, account`,
      [context.tenantId, hash],
    );
    const invitation = found.rows[0];
    if (
      !invitation ||
      !isTenantInvitationAcceptable({
        status: invitation.status,
        expiresAt: invitation.expires_at,
        consumedAt: invitation.consumed_at,
        revokedAt: invitation.revoked_at,
      })
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "The invitation is invalid or expired.",
      );
    }
    const consumed = await client.query(
      `UPDATE tenant_invitations SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [invitation.invitation_id],
    );
    if (consumed.rowCount !== 1) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "The invitation is invalid or expired.",
      );
    }
    await client.query(
      `UPDATE tenant_users SET status = 'ACTIVE', "emailVerified" = true,
         "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = now()
       WHERE id = $1 AND "tenantId" = $2 AND status = 'INVITED'`,
      [invitation.user_id, context.tenantId],
    );
    await client.query(
      `INSERT INTO tenant_auth_accounts (id, "accountId", "providerId", "userId", password)
       VALUES ($1, $2, 'credential', $2, $3)
       ON CONFLICT ("providerId", "accountId") DO UPDATE SET password = EXCLUDED.password, "updatedAt" = now()`,
      [randomUUID(), invitation.user_id, passwordHash],
    );
    await audit(client, {
      tenantId: context.tenantId,
      actorId: invitation.user_id,
      action: "tenant_invitation.accepted",
      targetType: "TENANT_USER",
      targetId: invitation.user_id,
      requestId,
      afterState: { status: "ACTIVE" },
    });
  });
}

export async function listTenantUsers(
  context: TenantContext,
  profileType: "STAFF" | "INSTRUCTOR" | "PARTICIPANT",
) {
  const profileTable = {
    STAFF: "tenant_staff_profiles",
    INSTRUCTOR: "tenant_instructor_profiles",
    PARTICIPANT: "tenant_participant_profiles",
  }[profileType];
  const result = await getTenantPool(context).query(
    `SELECT account.id, account.name, CASE WHEN account.email LIKE '%@phone.eventos.invalid' THEN '' ELSE account.email END AS email, account.status,
            account."createdAt" AS created_at, account."lastLoginAt" AS last_login_at,
            COALESCE(array_agg(role.code ORDER BY role.code) FILTER (WHERE role.code IS NOT NULL), '{}') AS role_codes
     FROM tenant_users AS account
     LEFT JOIN tenant_user_roles AS user_role ON user_role.tenant_id = $1 AND user_role.user_id = account.id
     LEFT JOIN tenant_roles AS role ON role.tenant_id = user_role.tenant_id AND role.id = user_role.role_id
     WHERE account."tenantId" = $1
       AND EXISTS (SELECT 1 FROM ${profileTable} AS profile WHERE profile.tenant_id = $1 AND profile.user_id = account.id)
     GROUP BY account.id ORDER BY account."createdAt" DESC LIMIT 200`,
    [context.tenantId],
  );
  return result.rows;
}

export async function assignTenantUserRoles(
  context: TenantContext,
  targetUserId: string,
  roleCodes: string[],
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  assertActorTenant(context, actor);
  authorize(actor.permissions, "role.assign");
  await transaction(context, async (client) => {
    await client.query(
      "SELECT id FROM tenant_roles WHERE tenant_id = $1 AND code = 'organization_owner' FOR UPDATE",
      [context.tenantId],
    );
    const target = await client.query<{ status: string; had_owner: boolean }>(
      `SELECT account.status,
              EXISTS (SELECT 1 FROM tenant_user_roles AS ur JOIN tenant_roles AS role
                ON role.tenant_id = ur.tenant_id AND role.id = ur.role_id
               WHERE ur.tenant_id = account."tenantId" AND ur.user_id = account.id AND role.code = 'organization_owner') AS had_owner
       FROM tenant_users AS account WHERE account.id = $1 AND account."tenantId" = $2 FOR UPDATE`,
      [targetUserId, context.tenantId],
    );
    const row = target.rows[0];
    if (!row)
      throw new DomainError("NOT_FOUND", "The tenant user was not found.");
    const roles = await client.query<{
      code: string;
      id: string;
      permission_key: string | null;
    }>(
      `SELECT role.code, role.id, role_permission.permission_key
       FROM tenant_roles AS role LEFT JOIN tenant_role_permissions AS role_permission
         ON role_permission.tenant_id = role.tenant_id AND role_permission.role_id = role.id
       WHERE role.tenant_id = $1 AND role.code = ANY($2::varchar[])
       ORDER BY role.code, role_permission.permission_key FOR SHARE OF role`,
      [context.tenantId, roleCodes],
    );
    const roleSet = new Set(roles.rows.map((item) => item.code));
    if (roleSet.size !== roleCodes.length) {
      throw new DomainError("VALIDATION_FAILED", "Choose valid tenant roles.");
    }
    assertCanGrantPermissions(
      actor.permissions,
      roles.rows.flatMap((item) =>
        item.permission_key ? [item.permission_key] : [],
      ),
    );
    const wantsOwner = roleSet.has("organization_owner");
    if (row.had_owner && !wantsOwner && row.status === "ACTIVE") {
      const owners = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_user_roles AS user_role
         JOIN tenant_users AS account ON account.id = user_role.user_id AND account."tenantId" = user_role.tenant_id
         JOIN tenant_roles AS role ON role.id = user_role.role_id AND role.tenant_id = user_role.tenant_id
         WHERE user_role.tenant_id = $1 AND role.code = 'organization_owner' AND account.status = 'ACTIVE'`,
        [context.tenantId],
      );
      if ((owners.rows[0]?.count ?? 0) <= 1) {
        throw new DomainError(
          "CONFLICT",
          "The last active organization owner cannot be removed.",
        );
      }
    }
    const before = await client.query<{ code: string }>(
      `SELECT role.code FROM tenant_user_roles AS ur JOIN tenant_roles AS role
         ON role.tenant_id = ur.tenant_id AND role.id = ur.role_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2 ORDER BY role.code`,
      [context.tenantId, targetUserId],
    );
    const beforeRoleCodes = before.rows.map((item) => item.code);
    const afterRoleCodes = [...roleSet].sort();
    await client.query(
      "DELETE FROM tenant_user_roles WHERE tenant_id = $1 AND user_id = $2",
      [context.tenantId, targetUserId],
    );
    for (const code of [...roleSet].sort()) {
      await client.query(
        `INSERT INTO tenant_user_roles (tenant_id, user_id, role_id, assigned_by)
         SELECT $1, $2, id, $3 FROM tenant_roles WHERE tenant_id = $1 AND code = $4`,
        [context.tenantId, targetUserId, actor.id, code],
      );
    }
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action: "tenant_user.roles_changed",
      targetType: "TENANT_USER",
      targetId: targetUserId,
      requestId,
      beforeState: { roleCodes: beforeRoleCodes },
      afterState: { roleCodes: afterRoleCodes },
    });
    for (const code of afterRoleCodes.filter(
      (roleCode) => !beforeRoleCodes.includes(roleCode),
    )) {
      await audit(client, {
        tenantId: context.tenantId,
        actorId: actor.id,
        action: "user.role_assigned",
        targetType: "TENANT_USER",
        targetId: targetUserId,
        requestId,
        afterState: { roleCode: code },
      });
    }
    for (const code of beforeRoleCodes.filter(
      (roleCode) => !afterRoleCodes.includes(roleCode),
    )) {
      await audit(client, {
        tenantId: context.tenantId,
        actorId: actor.id,
        action: "user.role_removed",
        targetType: "TENANT_USER",
        targetId: targetUserId,
        requestId,
        beforeState: { roleCode: code },
      });
    }
  });
}

export async function updateTenantUserStatus(
  context: TenantContext,
  targetUserId: string,
  status: "ACTIVE" | "SUSPENDED" | "DISABLED",
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  assertActorTenant(context, actor);
  await transaction(context, async (client) => {
    await client.query(
      "SELECT id FROM tenant_roles WHERE tenant_id = $1 AND code = 'organization_owner' FOR UPDATE",
      [context.tenantId],
    );
    const target = await client.query<{
      status: string;
      is_owner: boolean;
      profile_type: "STAFF" | "INSTRUCTOR" | "PARTICIPANT" | null;
    }>(
      `SELECT account.status, CASE
                WHEN EXISTS (SELECT 1 FROM tenant_staff_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'STAFF'
                WHEN EXISTS (SELECT 1 FROM tenant_instructor_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'INSTRUCTOR'
                WHEN EXISTS (SELECT 1 FROM tenant_participant_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'PARTICIPANT'
                ELSE NULL END AS profile_type,
              EXISTS (
         SELECT 1 FROM tenant_user_roles AS ur JOIN tenant_roles AS role
           ON role.tenant_id = ur.tenant_id AND role.id = ur.role_id
         WHERE ur.tenant_id = account."tenantId" AND ur.user_id = account.id AND role.code = 'organization_owner'
       ) AS is_owner
       FROM tenant_users AS account WHERE account.id = $1 AND account."tenantId" = $2 FOR UPDATE`,
      [targetUserId, context.tenantId],
    );
    const row = target.rows[0];
    if (!row)
      throw new DomainError("NOT_FOUND", "The tenant user was not found.");
    authorize(
      actor.permissions,
      tenantStatusPermission(row.profile_type ?? "STAFF", status),
    );
    if (row.profile_type !== "STAFF" && !context.features.crm) {
      throw new DomainError(
        "FEATURE_DISABLED",
        "This feature is not enabled for the tenant.",
      );
    }
    if (row.status === "INVITED" && status === "ACTIVE") {
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Invited users must activate through their invitation.",
      );
    }
    if (row.status === status) return;
    if (row.is_owner && row.status === "ACTIVE" && status !== "ACTIVE") {
      const owners = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_user_roles AS user_role
         JOIN tenant_users AS account ON account.id = user_role.user_id AND account."tenantId" = user_role.tenant_id
         JOIN tenant_roles AS role ON role.id = user_role.role_id AND role.tenant_id = user_role.tenant_id
         WHERE user_role.tenant_id = $1 AND role.code = 'organization_owner' AND account.status = 'ACTIVE'`,
        [context.tenantId],
      );
      if ((owners.rows[0]?.count ?? 0) <= 1) {
        throw new DomainError(
          "CONFLICT",
          "The last active organization owner cannot be suspended.",
        );
      }
    }
    await client.query(
      `UPDATE tenant_users SET status = $3, "updatedAt" = now()
       WHERE id = $1 AND "tenantId" = $2`,
      [targetUserId, context.tenantId, status],
    );
    if (status !== "ACTIVE") {
      const revokedSessions = await client.query(
        'DELETE FROM tenant_auth_sessions WHERE "tenantId" = $1 AND "userId" = $2 RETURNING id',
        [context.tenantId, targetUserId],
      );
      if (revokedSessions.rowCount) {
        await audit(client, {
          tenantId: context.tenantId,
          actorId: actor.id,
          action: "session.revoked",
          targetType: "TENANT_USER",
          targetId: targetUserId,
          requestId,
          afterState: {
            count: revokedSessions.rowCount,
            reason: "account_status_changed",
          },
        });
      }
    }
    const profileType = row.profile_type ?? "STAFF";
    const profileName = profileType.toLowerCase();
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action:
        status === "ACTIVE"
          ? `${profileName}.reactivated`
          : status === "SUSPENDED"
            ? `${profileName}.suspended`
            : `${profileName}.disabled`,
      targetType: "TENANT_USER",
      targetId: targetUserId,
      requestId,
      beforeState: { status: row.status },
      afterState: { status },
    });
  });
}

export async function updateTenantUserProfile(
  context: TenantContext,
  targetUserId: string,
  input: {
    name?: string | undefined;
    title?: string | null | undefined;
    displayName?: string | undefined;
  },
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  assertActorTenant(context, actor);
  await transaction(context, async (client) => {
    const target = await client.query<{
      name: string;
      profile_type: "STAFF" | "INSTRUCTOR" | "PARTICIPANT" | null;
    }>(
      `SELECT account.name, CASE
         WHEN EXISTS (SELECT 1 FROM tenant_staff_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'STAFF'
         WHEN EXISTS (SELECT 1 FROM tenant_instructor_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'INSTRUCTOR'
         WHEN EXISTS (SELECT 1 FROM tenant_participant_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'PARTICIPANT'
         ELSE NULL END AS profile_type
       FROM tenant_users AS account WHERE account.id = $1 AND account."tenantId" = $2 FOR UPDATE`,
      [targetUserId, context.tenantId],
    );
    const row = target.rows[0];
    if (!row?.profile_type)
      throw new DomainError("NOT_FOUND", "The tenant user was not found.");
    const permission = {
      STAFF: "staff.update",
      INSTRUCTOR: "instructor.update",
      PARTICIPANT: "participant.update",
    }[row.profile_type];
    authorize(actor.permissions, permission);
    if (row.profile_type !== "STAFF" && !context.features.crm) {
      throw new DomainError(
        "FEATURE_DISABLED",
        "This feature is not enabled for the tenant.",
      );
    }
    if (input.name !== undefined) {
      await client.query(
        `UPDATE tenant_users SET name = $3, "updatedAt" = now()
         WHERE id = $1 AND "tenantId" = $2`,
        [targetUserId, context.tenantId, input.name],
      );
    }
    if (row.profile_type === "STAFF" && input.title !== undefined) {
      await client.query(
        `UPDATE tenant_staff_profiles SET title = $3, updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, targetUserId, input.title],
      );
    }
    if (row.profile_type === "INSTRUCTOR" && input.displayName !== undefined) {
      await client.query(
        `UPDATE tenant_instructor_profiles SET display_name = $3, updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, targetUserId, input.displayName],
      );
    }
    if (row.profile_type === "PARTICIPANT" && input.displayName !== undefined) {
      await client.query(
        `UPDATE tenant_participant_profiles SET display_name = $3, updated_at = now()
         WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, targetUserId, input.displayName],
      );
    }
    const profileName = row.profile_type.toLowerCase();
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action: `${profileName}.updated`,
      targetType: "TENANT_USER",
      targetId: targetUserId,
      requestId,
      beforeState: { profileType: row.profile_type },
      afterState: {
        changedFields: Object.keys(input).filter(
          (key) => input[key as keyof typeof input] !== undefined,
        ),
      },
    });
  });
}

export async function revokeTenantUserInvitation(
  context: TenantContext,
  targetUserId: string,
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  assertActorTenant(context, actor);
  await transaction(context, async (client) => {
    const target = await client.query<{
      status: string;
      profile_type: "STAFF" | "INSTRUCTOR" | "PARTICIPANT" | null;
    }>(
      `SELECT account.status, CASE
         WHEN EXISTS (SELECT 1 FROM tenant_staff_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'STAFF'
         WHEN EXISTS (SELECT 1 FROM tenant_instructor_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'INSTRUCTOR'
         WHEN EXISTS (SELECT 1 FROM tenant_participant_profiles p WHERE p.tenant_id = account."tenantId" AND p.user_id = account.id) THEN 'PARTICIPANT'
         ELSE NULL END AS profile_type
       FROM tenant_users AS account WHERE account.id = $1 AND account."tenantId" = $2 FOR UPDATE`,
      [targetUserId, context.tenantId],
    );
    const row = target.rows[0];
    if (row?.status !== "INVITED")
      throw new DomainError(
        "NOT_FOUND",
        "The pending invitation was not found.",
      );
    const permission = {
      STAFF: "staff.suspend",
      INSTRUCTOR: "instructor.suspend",
      PARTICIPANT: "participant.suspend",
    }[row.profile_type ?? "STAFF"];
    authorize(actor.permissions, permission);
    const revoked = await client.query(
      `UPDATE tenant_invitations SET revoked_at = now()
       WHERE tenant_id = $1 AND user_id = $2 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [context.tenantId, targetUserId],
    );
    if (revoked.rowCount !== 1)
      throw new DomainError(
        "NOT_FOUND",
        "The pending invitation was not found.",
      );
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action: "tenant_invitation.revoked",
      targetType: "TENANT_USER",
      targetId: targetUserId,
      requestId,
      afterState: { revoked: true },
    });
  });
}

export async function listTenantRoles(context: TenantContext) {
  const result = await getTenantPool(context).query(
    `SELECT role.id, role.code, role.name, role.description, role.is_system,
            COALESCE(array_agg(role_permission.permission_key ORDER BY role_permission.permission_key)
              FILTER (WHERE role_permission.permission_key IS NOT NULL), '{}') AS permission_keys,
            (SELECT count(*)::int FROM tenant_user_roles AS ur
             WHERE ur.tenant_id = role.tenant_id AND ur.role_id = role.id) AS user_count
     FROM tenant_roles AS role LEFT JOIN tenant_role_permissions AS role_permission
       ON role_permission.tenant_id = role.tenant_id AND role_permission.role_id = role.id
     WHERE role.tenant_id = $1 GROUP BY role.tenant_id, role.id ORDER BY role.is_system DESC, role.name`,
    [context.tenantId],
  );
  return result.rows;
}

export async function listTenantPermissions(context: TenantContext) {
  const result = await getTenantPool(context).query(
    `SELECT key, module, name, description, high_risk
     FROM tenant_permissions WHERE tenant_id = $1 ORDER BY module, key`,
    [context.tenantId],
  );
  return result.rows;
}

export async function createTenantRole(
  context: TenantContext,
  input: {
    code: string;
    name: string;
    description: string;
    permissionKeys: string[];
  },
  actor: TenantActor,
  requestId: string,
) {
  assertActorTenant(context, actor);
  authorize(actor.permissions, "role.create");
  return transaction(context, async (client) => {
    const permissions = await client.query<{ key: string }>(
      "SELECT key FROM tenant_permissions WHERE tenant_id = $1 AND key = ANY($2::varchar[]) FOR SHARE",
      [context.tenantId, input.permissionKeys],
    );
    if (permissions.rowCount !== input.permissionKeys.length) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Choose known tenant permissions.",
      );
    }
    assertCanGrantPermissions(actor.permissions, input.permissionKeys);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tenant_roles (tenant_id, code, name, description, is_system)
       VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [context.tenantId, input.code, input.name, input.description],
    );
    const id = inserted.rows[0]?.id;
    if (!id)
      throw new Error("Tenant role creation did not return an identifier.");
    for (const permissionKey of input.permissionKeys) {
      await client.query(
        "INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key) VALUES ($1, $2, $3)",
        [context.tenantId, id, permissionKey],
      );
    }
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action: "tenant_role.created",
      targetType: "TENANT_ROLE",
      targetId: id,
      requestId,
      afterState: { code: input.code, permissionKeys: input.permissionKeys },
    });
    return { id, code: input.code };
  });
}

export async function updateTenantRole(
  context: TenantContext,
  roleId: string,
  input: { name: string; description: string; permissionKeys: string[] },
  actor: TenantActor,
  requestId: string,
) {
  assertActorTenant(context, actor);
  authorize(actor.permissions, "role.update");
  return transaction(context, async (client) => {
    const role = await client.query<{
      code: string;
      name: string;
      description: string;
      is_system: boolean;
    }>(
      "SELECT code, name, description, is_system FROM tenant_roles WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [context.tenantId, roleId],
    );
    const before = role.rows[0];
    if (!before)
      throw new DomainError("NOT_FOUND", "The tenant role was not found.");
    assertRoleIsMutable(before.is_system);
    const permissionRows = await client.query<{ key: string }>(
      "SELECT key FROM tenant_permissions WHERE tenant_id = $1 AND key = ANY($2::varchar[]) FOR SHARE",
      [context.tenantId, input.permissionKeys],
    );
    if (permissionRows.rowCount !== input.permissionKeys.length) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Choose known tenant permissions.",
      );
    }
    assertCanGrantPermissions(actor.permissions, input.permissionKeys);
    const currentPermissions = await client.query<{ permission_key: string }>(
      "SELECT permission_key FROM tenant_role_permissions WHERE tenant_id = $1 AND role_id = $2",
      [context.tenantId, roleId],
    );
    const users = await client.query<{ user_id: string; status: string }>(
      `SELECT user_role.user_id, account.status FROM tenant_user_roles AS user_role
       JOIN tenant_users AS account ON account.id = user_role.user_id AND account."tenantId" = user_role.tenant_id
       WHERE user_role.tenant_id = $1 AND user_role.role_id = $2`,
      [context.tenantId, roleId],
    );
    if (users.rows.some((user) => user.status === "ACTIVE")) {
      assertOwnerRoleGrantsPreserved(
        before.code,
        users.rows.filter((user) => user.status === "ACTIVE").length,
        currentPermissions.rows.map((permission) => permission.permission_key),
        new Set(input.permissionKeys),
      );
    }
    await client.query(
      "UPDATE tenant_roles SET name = $3, description = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2",
      [context.tenantId, roleId, input.name, input.description],
    );
    await client.query(
      "DELETE FROM tenant_role_permissions WHERE tenant_id = $1 AND role_id = $2",
      [context.tenantId, roleId],
    );
    for (const permissionKey of input.permissionKeys) {
      await client.query(
        "INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key) VALUES ($1, $2, $3)",
        [context.tenantId, roleId, permissionKey],
      );
    }
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action: "tenant_role.updated",
      targetType: "TENANT_ROLE",
      targetId: roleId,
      requestId,
      beforeState: {
        name: before.name,
        description: before.description,
        permissionKeys: currentPermissions.rows.map(
          (permission) => permission.permission_key,
        ),
      },
      afterState: {
        name: input.name,
        description: input.description,
        permissionKeys: input.permissionKeys,
      },
    });
    const previousPermissions = new Set(
      currentPermissions.rows.map((permission) => permission.permission_key),
    );
    const nextPermissions = new Set(input.permissionKeys);
    for (const permissionKey of [...nextPermissions].filter(
      (key) => !previousPermissions.has(key),
    )) {
      await audit(client, {
        tenantId: context.tenantId,
        actorId: actor.id,
        action: "role.permission_added",
        targetType: "TENANT_ROLE",
        targetId: roleId,
        requestId,
        afterState: { permissionKey },
      });
    }
    for (const permissionKey of [...previousPermissions].filter(
      (key) => !nextPermissions.has(key),
    )) {
      await audit(client, {
        tenantId: context.tenantId,
        actorId: actor.id,
        action: "role.permission_removed",
        targetType: "TENANT_ROLE",
        targetId: roleId,
        requestId,
        beforeState: { permissionKey },
      });
    }
    return { id: roleId };
  });
}

export async function deleteTenantRole(
  context: TenantContext,
  roleId: string,
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  assertActorTenant(context, actor);
  authorize(actor.permissions, "role.delete");
  await transaction(context, async (client) => {
    const role = await client.query<{
      code: string;
      name: string;
      is_system: boolean;
    }>(
      "SELECT code, name, is_system FROM tenant_roles WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [context.tenantId, roleId],
    );
    const row = role.rows[0];
    if (!row)
      throw new DomainError("NOT_FOUND", "The tenant role was not found.");
    assertRoleIsMutable(row.is_system);
    const assigned = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM tenant_user_roles WHERE tenant_id = $1 AND role_id = $2",
      [context.tenantId, roleId],
    );
    if ((assigned.rows[0]?.count ?? 0) > 0) {
      throw new DomainError(
        "CONFLICT",
        "Remove this role from users before deleting it.",
      );
    }
    await client.query(
      "DELETE FROM tenant_roles WHERE tenant_id = $1 AND id = $2",
      [context.tenantId, roleId],
    );
    await audit(client, {
      tenantId: context.tenantId,
      actorId: actor.id,
      action: "tenant_role.deleted",
      targetType: "TENANT_ROLE",
      targetId: roleId,
      requestId,
      beforeState: { code: row.code, name: row.name },
    });
  });
}

export async function listTenantAudit(context: TenantContext) {
  const result = await getTenantPool(context).query(
    `SELECT id, actor_id, action, target_type, target_id, request_id, before_state, after_state, created_at
     FROM tenant_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [context.tenantId],
  );
  return result.rows;
}

export async function clearOwnerBootstrap(jobId: string): Promise<void> {
  const { getControlPool } = await import("@/infrastructure/db/control/pool");
  await getControlPool().query(
    "UPDATE provisioning_jobs SET owner_bootstrap_ciphertext = NULL WHERE id = $1",
    [jobId],
  );
}
