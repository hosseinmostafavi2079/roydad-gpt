import { getRun, updateRun } from "@/modules/program-core/repository";
import { resourceId, runInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };
export function GET(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      getRun(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).runId),
      ),
    "program.read",
    { feature: "courses" },
  );
}
export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateRun(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).runId),
        await parseJson(request, runInput),
      ),
    "program.update",
    { mutation: true, feature: "courses" },
  );
}
