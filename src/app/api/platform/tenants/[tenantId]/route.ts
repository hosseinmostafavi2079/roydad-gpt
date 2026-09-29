import {
  getTenantDetails,
  updateTenant,
} from "@/modules/platform/tenants/service";
import {
  tenantIdSchema,
  updateTenantSchema,
} from "@/modules/platform/tenants/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
import { invalidateTenantResolutionCache } from "@/modules/tenants/resolver";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function GET(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(request, async () => {
    const { tenantId } = await context.params;
    return getTenantDetails(tenantIdSchema.parse(tenantId));
  });
}

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const { tenantId } = await context.params;
      const id = tenantIdSchema.parse(tenantId);
      const result = await updateTenant(
        id,
        await parseJson(request, updateTenantSchema),
        actor,
        requestId,
      );
      invalidateTenantResolutionCache(id);
      return result;
    },
    { mutation: true },
  );
}
