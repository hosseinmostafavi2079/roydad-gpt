import { cancelSession } from "@/modules/program-core/repository";
import { resourceId } from "@/modules/program-core/schema";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ sessionId: string }> };
export function POST(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      cancelSession(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).sessionId),
      ),
    "session.manage",
    { mutation: true, feature: "courses" },
  );
}
