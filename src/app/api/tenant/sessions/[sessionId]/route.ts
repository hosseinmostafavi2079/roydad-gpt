import { getSession, updateSession } from "@/modules/program-core/repository";
import { resourceId, sessionInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ sessionId: string }> };
export function GET(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      getSession(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).sessionId),
      ),
    "session.read",
    { feature: "courses" },
  );
}
export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateSession(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).sessionId),
        await parseJson(request, sessionInput),
      ),
    "session.manage",
    { mutation: true, feature: "courses" },
  );
}
