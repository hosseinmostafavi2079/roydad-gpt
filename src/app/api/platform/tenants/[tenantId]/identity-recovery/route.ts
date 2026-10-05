import { getControlPool } from "@/infrastructure/db/control/pool";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { identityAudit } from "@/modules/tenant-identity/identity-v2-repository";
import { DomainError } from "@/shared/errors/domain-error";
export function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  return withPlatformAdminRoute(
    request,
    async (_actor, requestId) => {
      const id = tenantIdSchema.parse((await context.params).tenantId);
      const result = await getControlPool().query<{ hostname: string }>(
        "SELECT hostname FROM tenant_domains WHERE tenant_id=$1 AND is_primary=true AND verified_at IS NOT NULL",
        [id],
      );
      const hostname = result.rows[0]?.hostname;
      if (!hostname)
        throw new DomainError("NOT_FOUND", "Tenant was not found.");
      const tenant = await resolveTenantContext(hostname);
      if (tenant.tenantId !== id || !tenant.features.password_login)
        throw new DomainError(
          "FEATURE_DISABLED",
          "Enable platform password capability before recovery.",
        );
      await getTenantPool(tenant).query(
        `UPDATE tenant_identity_settings SET login_methods=jsonb_set(login_methods,'{email_password}','true'),updated_at=now() WHERE tenant_id=$1`,
        [id],
      );
      await identityAudit(tenant, null, "auth.platform_recovery", requestId);
      return { success: true };
    },
    { mutation: true },
  );
}
