import { transitionRun } from "@/modules/program-core/repository";
import { resourceId } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";
import { z } from "zod";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };
const input = z.strictObject({
  state: z.enum(["PRIVATE", "PUBLISHED", "CANCELLED", "COMPLETED"]),
});
export function POST(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      transitionRun(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).runId),
        (await parseJson(request, input)).state,
      ),
    undefined,
    { mutation: true, feature: "courses" },
  );
}
