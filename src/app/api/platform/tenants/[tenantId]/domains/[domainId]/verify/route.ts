import { verifyCustomDomain } from "@/modules/platform/tenants/service";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";
import { z } from "zod";
import { invalidateTenantResolutionCache } from "@/modules/tenants/resolver";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; domainId: string }> };

export function POST(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const { tenantId, domainId } = await context.params;
      const id = tenantIdSchema.parse(tenantId);
      const domain = z.string().uuid().parse(domainId);
      const result = await verifyCustomDomain(id, domain, actor, requestId);
      invalidateTenantResolutionCache(id);
      return result;
    },
    { mutation: true },
  );
}
