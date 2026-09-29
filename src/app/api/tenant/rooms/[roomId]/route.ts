import { getRoom, updateRoom } from "@/modules/program-core/repository";
import { resourceId, roomInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ roomId: string }> };
export function GET(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(request, async ({ tenant }, actor, requestId) =>
    getRoom(
      { tenant, actor, requestId },
      resourceId.parse((await context.params).roomId),
    ),
  );
}
export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateRoom(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).roomId),
        await parseJson(request, roomInput),
      ),
    "settings.manage",
    { mutation: true },
  );
}
