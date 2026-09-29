import { updateTenantLimits } from "@/modules/platform/tenants/service";
import {
  tenantIdSchema,
  updateTenantLimitsSchema,
} from "@/modules/platform/tenants/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
import { invalidateTenantResolutionCache } from "@/modules/tenants/resolver";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const { tenantId } = await context.params;
      const id = tenantIdSchema.parse(tenantId);
      const { overrides } = await parseJson(request, updateTenantLimitsSchema);
      const result = await updateTenantLimits(id, overrides, actor, requestId);
      invalidateTenantResolutionCache(id);
      return result;
    },
    { mutation: true },
  );
}
