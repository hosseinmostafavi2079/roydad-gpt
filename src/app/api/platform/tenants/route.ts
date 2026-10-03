import { createTenant, listTenants } from "@/modules/platform/tenants/service";
import {
  createTenantRequestSchema,
  listTenantsSchema,
} from "@/modules/platform/tenants/schema";
import {
  parseQuery,
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
import { invalidateTenantResolutionCache } from "@/modules/tenants/resolver";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withPlatformAdminRoute(request, async () =>
    listTenants(parseQuery(request, listTenantsSchema)),
  );
}

export function POST(request: Request): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const result = await createTenant(
        await parseJson(request, createTenantRequestSchema),
        actor,
        requestId,
      );
      invalidateTenantResolutionCache(result.tenant.id);
      return result;
    },
    { mutation: true },
  );
}
