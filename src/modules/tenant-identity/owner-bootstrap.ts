import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  getTenantPool,
  type TenantPoolContext,
} from "@/infrastructure/db/tenant/pool";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import { decryptTenantOwnerBootstrap } from "@/infrastructure/auth/tenant-bootstrap";
import { hashPlatformPassword } from "@/infrastructure/auth/password";
import { DomainError } from "@/shared/errors/domain-error";
import { normalizeUsername, normalizeIranianPhone } from "./identity-v2-schema";
import type { PlatformActor } from "@/infrastructure/auth/platform-session";
import { appendAuditRecord } from "@/modules/platform/audit/repository";

type Owner = ReturnType<typeof decryptTenantOwnerBootstrap>;
const verificationId = (tenantId: string) => `owner-bootstrap-${tenantId}`;
const codeHash = (code: string) =>
  createHash("sha256").update(code).digest("hex");

// Only the provisioning worker calls this initial-owner use case. No delivery state.
export async function provisionEmailFreeOwner(
  context: TenantPoolContext,
  owner: Owner,
  requestId: string,
) {
  if (
    !owner.username ||
    !owner.mobile ||
    !owner.activationCode ||
    !owner.expiresAt ||
    Date.parse(owner.expiresAt) <= Date.now()
  )
    throw new DomainError(
      "VALIDATION_FAILED",
      "اطلاعات راه‌اندازی مدیر اصلی معتبر نیست.",
    );
  const username = normalizeUsername(owner.username);
  const mobile = normalizeIranianPhone(owner.mobile);
  const client = await getTenantPool(context).connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `tenant-owner-bootstrap:${context.tenantId}`,
    ]);
    const existing = await client.query<{
      id: string;
      username: string;
      status: string;
    }>(
      `SELECT account.id,account.username,account.status FROM tenant_users account JOIN tenant_user_roles grant_role ON grant_role.tenant_id=account."tenantId" AND grant_role.user_id=account.id JOIN tenant_roles role ON role.tenant_id=grant_role.tenant_id AND role.id=grant_role.role_id WHERE role.tenant_id=$1 AND role.code='organization_owner' FOR UPDATE OF account`,
      [context.tenantId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (
        existing.rowCount !== 1 ||
        row?.username !== username ||
        !["INVITED", "ACTIVE"].includes(row.status)
      )
        throw new DomainError("CONFLICT", "مدیر اصلی قبلاً تعیین شده است.");
      const setup = await client.query(
        'SELECT 1 FROM tenant_auth_verifications WHERE id=$1 AND value=$2 AND identifier=$3 AND "expiresAt">now()',
        [
          verificationId(context.tenantId),
          codeHash(owner.activationCode),
          `owner-bootstrap:${context.tenantId}:${row.id}`,
        ],
      );
      if (row.status === "INVITED" && setup.rowCount !== 1)
        throw new DomainError(
          "CONFLICT",
          "راه‌اندازی مدیر اصلی نیازمند بررسی است.",
        );
      await client.query("COMMIT");
      return;
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO tenant_users (id,"tenantId",name,email,username,mobile,"phoneNumber",status) VALUES ($1,$2,$3,$4,$5,$6,$6,'INVITED')`,
      [
        id,
        context.tenantId,
        owner.name,
        owner.email ?? `${id}@phone.eventos.invalid`,
        username,
        mobile,
      ],
    );
    const grant = await client.query(
      `INSERT INTO tenant_user_roles (tenant_id,user_id,role_id) SELECT $1,$2,id FROM tenant_roles WHERE tenant_id=$1 AND code='organization_owner'`,
      [context.tenantId, id],
    );
    if (grant.rowCount !== 1)
      throw new DomainError("CONFLICT", "نقش مدیر اصلی معتبر نیست.");
    await client.query(
      "INSERT INTO tenant_staff_profiles (tenant_id,user_id) VALUES ($1,$2)",
      [context.tenantId, id],
    );
    await client.query(
      `INSERT INTO tenant_auth_accounts (id,"accountId","providerId","userId") VALUES ($1,$2,'credential',$2)`,
      [randomUUID(), id],
    );
    await client.query(
      `INSERT INTO tenant_auth_verifications (id,identifier,value,"expiresAt") VALUES ($1,$2,$3,$4)`,
      [
        verificationId(context.tenantId),
        `owner-bootstrap:${context.tenantId}:${id}`,
        codeHash(owner.activationCode),
        owner.expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,action,target_type,target_id,request_id) VALUES ($1,'tenant_owner.bootstrap_prepared','TENANT_USER',$2,$3)`,
      [context.tenantId, id, requestId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function activateInitialOwner(
  context: TenantPoolContext,
  usernameValue: string,
  activationCode: string,
  password: string,
  requestId: string,
) {
  const username = normalizeUsername(usernameValue);
  const passwordHash = await hashPlatformPassword(password);
  const client = await getTenantPool(context).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(
      `SELECT account.id FROM tenant_users account JOIN tenant_auth_verifications setup ON setup.identifier='owner-bootstrap:'||account."tenantId"::text||':'||account.id JOIN tenant_user_roles grant_role ON grant_role.tenant_id=account."tenantId" AND grant_role.user_id=account.id JOIN tenant_roles role ON role.tenant_id=grant_role.tenant_id AND role.id=grant_role.role_id WHERE account."tenantId"=$1 AND account.username=$2 AND account.status='INVITED' AND role.code='organization_owner' AND setup.id=$3 AND setup.value=$4 AND setup."expiresAt">now() FOR UPDATE OF setup,account`,
      [
        context.tenantId,
        username,
        verificationId(context.tenantId),
        codeHash(activationCode),
      ],
    );
    const user = result.rows[0];
    if (!user || result.rowCount !== 1)
      throw new DomainError(
        "VALIDATION_FAILED",
        "کد راه‌اندازی نامعتبر یا منقضی است.",
      );
    const updated = await client.query(
      `UPDATE tenant_auth_accounts SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"='credential' AND password IS NULL`,
      [user.id, passwordHash],
    );
    if (updated.rowCount !== 1)
      throw new DomainError("CONFLICT", "حساب قبلاً راه‌اندازی شده است.");
    await client.query(
      `UPDATE tenant_users SET status='ACTIVE',"ownerPasswordSetupAt"=now(),"updatedAt"=now() WHERE "tenantId"=$1 AND id=$2`,
      [context.tenantId, user.id],
    );
    await client.query("DELETE FROM tenant_auth_verifications WHERE id=$1", [
      verificationId(context.tenantId),
    ]);
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1,$2,'tenant_owner.bootstrap_activated','TENANT_USER',$2,$3)`,
      [context.tenantId, user.id, requestId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Deliberate one-time retrieval, authorized by the platform route, never a GET/RSC payload.
export async function claimInitialOwnerAccess(
  tenantId: string,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const result = await client.query<{ owner_access_ciphertext: Buffer }>(
      `UPDATE provisioning_jobs job SET owner_access_ciphertext=NULL,owner_access_expires_at=NULL FROM (SELECT id,owner_access_ciphertext FROM provisioning_jobs WHERE tenant_id=$1 AND state='ACTIVE' AND owner_access_ciphertext IS NOT NULL AND owner_access_expires_at>now() FOR UPDATE) available WHERE job.id=available.id RETURNING available.owner_access_ciphertext`,
      [tenantId],
    );
    if (result.rowCount !== 1)
      throw new DomainError(
        "NOT_FOUND",
        "دسترسی یک‌بارمصرف موجود نیست یا قبلاً دریافت شده است.",
      );
    const owner = decryptTenantOwnerBootstrap(
      tenantId,
      result.rows[0]!.owner_access_ciphertext,
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.owner_access_claimed",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
    });
    return {
      username: owner.username,
      activationCode: owner.activationCode,
      expiresAt: owner.expiresAt,
    };
  });
}

export async function ownerAccessAvailable(tenantId: string) {
  const result = await getControlPool().query(
    `SELECT 1 FROM provisioning_jobs WHERE tenant_id=$1 AND state='ACTIVE' AND owner_access_ciphertext IS NOT NULL AND owner_access_expires_at>now()`,
    [tenantId],
  );
  return result.rowCount === 1;
}
