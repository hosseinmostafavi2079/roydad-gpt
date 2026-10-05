import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { withTenantRoute, parseJson } from "@/shared/http/tenant-route";
import { getTenantAuth } from "@/modules/tenant-identity/auth";
import {
  getIdentitySettings,
  identityThrottle,
  identityAudit,
} from "@/modules/tenant-identity/identity-v2-repository";
import { normalizeUsername } from "@/modules/tenant-identity/identity-v2-schema";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { DomainError } from "@/shared/errors/domain-error";
export function GET(request: Request) {
  return withTenantRoute(request, async ({ tenant }, actor) => {
    const result = await getTenantPool(tenant).query<{
      username: string | null;
      phoneNumber: string | null;
      phoneNumberVerified: boolean;
    }>(
      'SELECT username,"phoneNumber","phoneNumberVerified" FROM tenant_users WHERE id=$1 AND "tenantId"=$2',
      [actor.id, tenant.tenantId],
    );
    return result.rows[0];
  });
}
export function POST(request: Request) {
  return withTenantRoute(
    request,
    async ({ tenant, origin }, actor, requestId) => {
      if (
        !(await getIdentitySettings(tenant)).methods.username_password ||
        !tenant.features.password_login
      )
        throw new DomainError("FEATURE_DISABLED", "نام کاربری فعال نیست.");
      await identityThrottle(tenant, `username-set:${actor.id}`, 60, 3);
      const input = await parseJson(
        request,
        z.strictObject({ username: z.string().max(30) }),
      );
      let username: string;
      try {
        username = normalizeUsername(input.username);
      } catch {
        throw new DomainError("VALIDATION_FAILED", "نام کاربری معتبر نیست.");
      }
      const body = { name: actor.name, username };
      try {
        await getTenantAuth(tenant, origin).api.updateUser({
          headers: request.headers,
          body,
        });
      } catch (error) {
        if (isAPIError(error) && error.statusCode === 400)
          throw new DomainError(
            "CONFLICT",
            "نام کاربری معتبر و آزاد لازم است؛ نام کاربری ثبت‌شده قابل تغییر نیست.",
          );
        throw error;
      }
      await identityAudit(
        tenant,
        actor.id,
        "auth.username_configured",
        requestId,
      );
      return { success: true };
    },
    undefined,
    { mutation: true },
  );
}
