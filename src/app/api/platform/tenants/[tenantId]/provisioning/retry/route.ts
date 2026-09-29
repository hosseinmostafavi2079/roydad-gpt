import { retryProvisioning } from "@/modules/platform/tenants/service";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

export function POST(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const { tenantId } = await context.params;
      return retryProvisioning(
        tenantIdSchema.parse(tenantId),
        actor,
        requestId,
      );
    },
    { mutation: true },
  );
}
