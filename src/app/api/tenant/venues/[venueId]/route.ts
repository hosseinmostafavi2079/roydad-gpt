import { getVenue, updateVenue } from "@/modules/program-core/repository";
import { resourceId, venueInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ venueId: string }> };
export function GET(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(request, async ({ tenant }, actor, requestId) =>
    getVenue(
      { tenant, actor, requestId },
      resourceId.parse((await context.params).venueId),
    ),
  );
}
export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateVenue(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).venueId),
        await parseJson(request, venueInput),
      ),
    "settings.manage",
    { mutation: true },
  );
}
