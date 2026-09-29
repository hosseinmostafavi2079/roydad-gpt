import { getControlPool } from "@/infrastructure/db/control/pool";
import { getServerConfig } from "@/shared/config/env";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { issueInitialTenantOwnerInvitation } from "@/modules/tenant-identity/repository";
import { tenantIdentityMigrationVersion } from "@/infrastructure/db/tenant/prisma-migrations";
import {
  tenantIdSchema,
  inviteTenantOwnerSchema,
} from "@/modules/platform/tenants/schema";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
import { DomainError } from "@/shared/errors/domain-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function POST(
  request: Request,
  routeContext: Context,
): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const tenantId = tenantIdSchema.parse(
        (await routeContext.params).tenantId,
      );
      const input = inviteTenantOwnerSchema.parse(
        await parseJson(request, inviteTenantOwnerSchema),
      );
      const result = await getControlPool().query<{
        slug: string;
        status: string;
        hostname: string | null;
        migration_version: string | null;
      }>(
        `SELECT tenant.slug, tenant.status,
                (SELECT hostname FROM tenant_domains WHERE tenant_id = tenant.id AND is_primary AND verified_at IS NOT NULL) AS hostname,
                registry.migration_version
         FROM tenants AS tenant JOIN tenant_database_registry AS registry ON registry.tenant_id = tenant.id
         WHERE tenant.id = $1`,
        [tenantId],
      );
      const tenant = result.rows[0];
      if (!tenant)
        throw new DomainError("NOT_FOUND", "The tenant was not found.");
      if (
        tenant.status !== "ACTIVE" ||
        tenant.migration_version !== tenantIdentityMigrationVersion ||
        !tenant.hostname
      ) {
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Tenant identity setup is not ready.",
        );
      }
      const context = await resolveTenantContext(tenant.hostname);
      const config = getServerConfig();
      const origin = `${config.NODE_ENV === "production" ? "https" : "http"}://${context.hostname}`;
      await issueInitialTenantOwnerInvitation(
        context,
        input,
        requestId,
        origin,
      );
      await withControlTransaction((client) =>
        appendAuditRecord(client, {
          actorType: "PLATFORM_ADMIN",
          actorId: actor.adminId,
          action: "tenant.owner_invitation_issued",
          targetType: "TENANT",
          targetId: tenantId,
          requestId,
          afterState: { invitationIssued: true },
        }),
      );
      return { invitationIssued: true };
    },
    { mutation: true },
  );
}
