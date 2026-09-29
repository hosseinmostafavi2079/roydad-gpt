import { createVenue, listVenues } from "@/modules/program-core/repository";
import { venueInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      listVenues({ tenant, actor, requestId }),
    undefined,
  );
}
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      createVenue(
        { tenant, actor, requestId },
        await parseJson(request, venueInput),
      ),
    "settings.manage",
    { mutation: true },
  );
}
