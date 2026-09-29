import { createRun, listRuns } from "@/modules/program-core/repository";
import { runInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      listRuns({ tenant, actor, requestId }),
    "program.read",
    { feature: "courses" },
  );
}
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      createRun(
        { tenant, actor, requestId },
        await parseJson(request, runInput),
      ),
    "program.create",
    { mutation: true, feature: "courses" },
  );
}
