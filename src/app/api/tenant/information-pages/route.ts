import {
  informationPageInput,
  listInformationPages,
  saveInformationPage,
} from "@/modules/public-site/content";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => listInformationPages(tenant, false),
    "website.manage",
  );
}
export function PUT(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      saveInformationPage(
        tenant,
        actor,
        await parseJson(request, informationPageInput),
        requestId,
      ),
    "website.manage",
    { mutation: true },
  );
}
