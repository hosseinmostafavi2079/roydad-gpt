import { changeTenantStatus } from "@/modules/platform/tenants/service";
import {
  tenantIdSchema,
  updateStatusSchema,
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
      const { status } = await parseJson(request, updateStatusSchema);
      const result = await changeTenantStatus(id, status, actor, requestId);
      invalidateTenantResolutionCache(id);
      return result;
    },
    { mutation: true },
  );
}
