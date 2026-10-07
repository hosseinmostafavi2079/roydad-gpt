import "server-only";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashPlatformPassword } from "@/infrastructure/auth/password";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { DomainError } from "@/shared/errors/domain-error";
import {
  type ActivateAdminInput,
  activateAdminSchema,
  adminIdSchema,
  type CreateAdminInput,
  createAdminSchema,
} from "./schema";

type AdminRow = {
  id: string;
  auth_user_id: string;
  activated_at: Date | null;
  revoked_at: Date | null;
};
export const activationError = "اطلاعات فعال‌سازی معتبر نیست یا منقضی شده است.";
const lifecycle = (row: AdminRow) =>
  row.revoked_at
    ? "REVOKED"
    : row.activated_at
      ? "ACTIVE"
      : "PENDING_ACTIVATION";
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class PlatformAdminRepository {
  constructor(private readonly pool: Pool = getControlPool()) {}
  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Every lifecycle mutation, including public activation, uses this same lock.
      // Check the actor again after locking; a stale HTTP session cannot race revocation.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('eventos-platform-admin-management',0))",
      );
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async actor(client: PoolClient, id: string) {
    const found = await client.query(
      "SELECT id FROM platform_admins WHERE id=$1 AND activated_at IS NOT NULL AND revoked_at IS NULL FOR UPDATE",
      [adminIdSchema.parse(id)],
    );
    if (!found.rowCount)
      throw new DomainError("FORBIDDEN", "دسترسی مدیر پلتفرم فعال نیست.");
  }
  private async target(client: PoolClient, id: string) {
    const result = await client.query<AdminRow>(
      "SELECT id,auth_user_id,activated_at,revoked_at FROM platform_admins WHERE id=$1 FOR UPDATE",
      [adminIdSchema.parse(id)],
    );
    if (!result.rows[0]) throw new DomainError("NOT_FOUND", "مدیر یافت نشد.");
    return result.rows[0];
  }
  private async audit(
    client: PoolClient,
    actorId: string | null,
    targetId: string,
    action: string,
    state: string,
    requestId: string,
  ) {
    await appendAuditRecord(client, {
      actorType: actorId ? "PLATFORM_ADMIN" : "SYSTEM",
      actorId,
      action: `platform_admin.${action}`,
      targetType: "PLATFORM_ADMIN",
      targetId,
      requestId,
      afterState: { status: state },
    });
  }
  private async issue(client: PoolClient, id: string, actorId: string) {
    await client.query(
      "UPDATE platform_admin_activations SET consumed_at=now(),updated_at=now() WHERE platform_admin_id=$1 AND consumed_at IS NULL",
      [id],
    );
    const activationCode = randomBytes(32).toString("base64url");
    const result = await client.query<{ expires_at: Date }>(
      "INSERT INTO platform_admin_activations(platform_admin_id,token_hash,expires_at,created_by_admin_id) VALUES($1,$2,now()+interval '24 hours',$3) RETURNING expires_at",
      [id, tokenHash(activationCode), actorId],
    );
    const expiresAt = result.rows[0]?.expires_at;
    if (!expiresAt) throw new Error("Activation could not be issued");
    return { activationCode, expiresAt };
  }
  async listPlatformAdmins(currentAdminId: string, offset = 0) {
    const result = await this.pool.query(
      'SELECT a.id,a.display_name,a.email,a.created_at,a.activated_at,a.revoked_at,COALESCE(u."twoFactorEnabled",false) AS mfa_enabled FROM platform_admins a JOIN platform_auth_users u ON u.id=a.auth_user_id ORDER BY a.created_at,a.id LIMIT 100 OFFSET $1',
      [offset],
    );
    const count = await this.pool.query(
      "SELECT count(*)::int AS count FROM platform_admins WHERE activated_at IS NOT NULL AND revoked_at IS NULL",
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string,
        displayName: row.display_name as string,
        email: row.email as string,
        createdAt: row.created_at as Date,
        activatedAt: row.activated_at as Date | null,
        revokedAt: row.revoked_at as Date | null,
        status: lifecycle(row),
        mfaEnabled: row.mfa_enabled as boolean,
        isCurrent: row.id === currentAdminId,
      })),
      activeCount: count.rows[0]?.count as number,
    };
  }
  async createPlatformAdmin(
    input: CreateAdminInput,
    actorId: string,
    requestId: string,
  ) {
    const value = createAdminSchema.parse(input);
    return this.transaction(async (client) => {
      await this.actor(client, actorId);
      const duplicate = await client.query(
        "SELECT id FROM platform_auth_users WHERE lower(email)=$1 UNION ALL SELECT auth_user_id FROM platform_admins WHERE lower(email)=$1",
        [value.email],
      );
      if (duplicate.rowCount)
        throw new DomainError("CONFLICT", "این ایمیل قبلاً ثبت شده است.");
      const id = randomUUID(),
        userId = randomUUID();
      await client.query(
        'INSERT INTO platform_auth_users(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
        [userId, value.displayName, value.email],
      );
      await client.query(
        "INSERT INTO platform_admins(id,auth_user_id,display_name,email,activated_at) VALUES($1,$2,$3,$4,NULL)",
        [id, userId, value.displayName, value.email],
      );
      const code = await this.issue(client, id, actorId);
      await this.audit(
        client,
        actorId,
        id,
        "created",
        "PENDING_ACTIVATION",
        requestId,
      );
      return { id, status: "PENDING_ACTIVATION", ...code };
    });
  }
  async regenerateActivation(id: string, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      await this.actor(client, actorId);
      const row = await this.target(client, id);
      if (lifecycle(row) !== "PENDING_ACTIVATION")
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "تولید کد فقط برای مدیر در انتظار فعال‌سازی ممکن است.",
        );
      const code = await this.issue(client, id, actorId);
      await this.audit(
        client,
        actorId,
        id,
        "activation_regenerated",
        "PENDING_ACTIVATION",
        requestId,
      );
      return { id, status: "PENDING_ACTIVATION", ...code };
    });
  }
  async activatePlatformAdmin(input: ActivateAdminInput, requestId: string) {
    const value = activateAdminSchema.parse(input);
    const accepted = await this.transaction(async (client) => {
      // A fixed global DB bucket bounds unknown-email attempts without persisting email/IP.
      const now = Date.now();
      const rate = await client.query<{ count: number }>(
        'INSERT INTO platform_auth_rate_limits(id,key,count,"lastRequest") VALUES($1,\'platform-admin-activation\',1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN platform_auth_rate_limits."lastRequest" < $2-60000 THEN 1 ELSE LEAST(platform_auth_rate_limits.count+1,101) END,"lastRequest"=CASE WHEN platform_auth_rate_limits."lastRequest" < $2-60000 THEN $2 ELSE platform_auth_rate_limits."lastRequest" END RETURNING count',
        [randomUUID(), now],
      );
      if ((rate.rows[0]?.count ?? 101) > 100) return false;
      const found = await client.query<AdminRow>(
        "SELECT id,auth_user_id,activated_at,revoked_at FROM platform_admins WHERE lower(email)=$1 FOR UPDATE",
        [value.email],
      );
      const row = found.rows[0];
      const tokens = row
        ? await client.query<{
            id: string;
            token_hash: string;
            expired: boolean;
            locked: boolean;
            failed_attempt_count: number;
          }>(
            "SELECT id,token_hash,expires_at<=now() AS expired,locked_until>now() AS locked,failed_attempt_count FROM platform_admin_activations WHERE platform_admin_id=$1 AND consumed_at IS NULL FOR UPDATE",
            [row.id],
          )
        : null;
      const token = tokens?.rows[0];
      const matches = timingSafeEqual(
        Buffer.from(token?.token_hash ?? "0".repeat(64)),
        Buffer.from(tokenHash(value.activationCode)),
      );
      if (
        !row ||
        lifecycle(row) !== "PENDING_ACTIVATION" ||
        !token ||
        token.locked
      )
        return false;
      if (!matches || token.expired) {
        await client.query(
          "UPDATE platform_admin_activations SET failed_attempt_count=CASE WHEN failed_attempt_count=5 THEN 1 ELSE failed_attempt_count+1 END,locked_until=CASE WHEN failed_attempt_count=4 THEN now()+interval '15 minutes' ELSE NULL END,updated_at=now() WHERE id=$1",
          [token.id],
        );
        return false; // Commit attempt counters, then return the generic error outside the transaction.
      }
      const hash = await hashPlatformPassword(value.password);
      // A pending identity may have encountered ordinary recovery/verification APIs.
      // Activation establishes exactly the chosen credential and requires fresh sign-in.
      await client.query(
        'DELETE FROM platform_auth_accounts WHERE "userId"=$1 AND "providerId"=\'credential\'',
        [row.auth_user_id],
      );
      await client.query(
        'DELETE FROM platform_auth_sessions WHERE "userId"=$1',
        [row.auth_user_id],
      );
      await client.query(
        'INSERT INTO platform_auth_accounts(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,$3,now())',
        [randomUUID(), row.auth_user_id, hash],
      );
      await client.query(
        'UPDATE platform_auth_users SET "emailVerified"=true,"updatedAt"=now() WHERE id=$1',
        [row.auth_user_id],
      );
      await client.query(
        "UPDATE platform_admins SET activated_at=now() WHERE id=$1",
        [row.id],
      );
      await client.query(
        "UPDATE platform_admin_activations SET consumed_at=now(),failed_attempt_count=0,locked_until=NULL,updated_at=now() WHERE platform_admin_id=$1 AND consumed_at IS NULL",
        [row.id],
      );
      await this.audit(client, null, row.id, "activated", "ACTIVE", requestId);
      return true;
    });
    if (!accepted) throw new DomainError("VALIDATION_FAILED", activationError);
    return { activated: true };
  }
  async revokePlatformAdmin(id: string, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      await this.actor(client, actorId);
      const row = await this.target(client, id);
      if (row.revoked_at)
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "مدیر قبلاً غیرفعال شده است.",
        );
      if (row.activated_at) {
        const count = await client.query(
          "SELECT count(*)::int AS count FROM platform_admins WHERE activated_at IS NOT NULL AND revoked_at IS NULL",
        );
        if (count.rows[0]?.count <= 1)
          throw new DomainError(
            "CONFLICT",
            "حداقل یک مدیر فعال باید در پلتفرم باقی بماند.",
          );
      }
      await client.query(
        "UPDATE platform_admins SET revoked_at=now() WHERE id=$1",
        [id],
      );
      await client.query(
        'DELETE FROM platform_auth_sessions WHERE "userId"=$1',
        [row.auth_user_id],
      );
      await client.query(
        "UPDATE platform_admin_activations SET consumed_at=now(),updated_at=now() WHERE platform_admin_id=$1 AND consumed_at IS NULL",
        [id],
      );
      await this.audit(client, actorId, id, "revoked", "REVOKED", requestId);
      return { id, status: "REVOKED" };
    });
  }
  async reactivatePlatformAdmin(
    id: string,
    actorId: string,
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.actor(client, actorId);
      const row = await this.target(client, id);
      if (!row.revoked_at)
        throw new DomainError("INVALID_STATE_TRANSITION", "مدیر غیرفعال نیست.");
      await client.query(
        "UPDATE platform_admins SET revoked_at=NULL WHERE id=$1",
        [id],
      );
      // Never restore sessions, even if historical data contained an old session.
      await client.query(
        'DELETE FROM platform_auth_sessions WHERE "userId"=$1',
        [row.auth_user_id],
      );
      const status = row.activated_at ? "ACTIVE" : "PENDING_ACTIVATION";
      const code: { activationCode?: string; expiresAt?: Date } =
        row.activated_at ? {} : await this.issue(client, id, actorId);
      await this.audit(client, actorId, id, "reactivated", status, requestId);
      return { id, status, ...code };
    });
  }
  async revokePlatformAdminSessions(
    id: string,
    actorId: string,
    requestId: string,
  ) {
    return this.transaction(async (client) => {
      await this.actor(client, actorId);
      const row = await this.target(client, id);
      if (lifecycle(row) !== "ACTIVE")
        throw new DomainError("INVALID_STATE_TRANSITION", "مدیر فعال نیست.");
      await client.query(
        'DELETE FROM platform_auth_sessions WHERE "userId"=$1',
        [row.auth_user_id],
      );
      await this.audit(
        client,
        actorId,
        id,
        "sessions_revoked",
        "ACTIVE",
        requestId,
      );
      return { id, status: "ACTIVE" };
    });
  }
}
