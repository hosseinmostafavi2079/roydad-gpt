import { createRoom } from "@/modules/program-core/repository";
import { roomInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      createRoom(
        { tenant, actor, requestId },
        await parseJson(request, roomInput),
      ),
    "settings.manage",
    { mutation: true },
  );
}
