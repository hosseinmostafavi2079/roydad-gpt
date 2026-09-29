import {
  getWebsiteProfile,
  updateWebsiteProfile,
  websiteProfileInput,
} from "@/modules/public-site/profile";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => getWebsiteProfile(tenant),
    "website.manage",
  );
}

export function PUT(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateWebsiteProfile(
        tenant,
        actor,
        await parseJson(request, websiteProfileInput),
        requestId,
      ),
    "website.manage",
    { mutation: true },
  );
}
