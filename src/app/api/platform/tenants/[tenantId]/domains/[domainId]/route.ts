import { removeTenantDomain } from "@/modules/platform/tenants/domains";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string; domainId: string }> };

export function DELETE(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const params = await context.params;
      return removeTenantDomain(
        tenantIdSchema.parse(params.tenantId),
        tenantIdSchema.parse(params.domainId),
        actor,
        requestId,
      );
    },
    { mutation: true },
  );
}
