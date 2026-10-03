import { z } from "zod";
import {
  deleteSiteEntry,
  listSiteEntries,
  saveSiteEntry,
  siteEntryInput,
} from "@/modules/public-site/content";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
const kind = z.enum(["FAQ", "TESTIMONIAL", "GALLERY"]);
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) =>
      listSiteEntries(
        tenant,
        kind.parse(new URL(request.url).searchParams.get("kind")),
        false,
      ),
    "website.manage",
  );
}
export function PUT(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      saveSiteEntry(
        tenant,
        actor,
        await parseJson(request, siteEntryInput),
        requestId,
      ),
    "website.manage",
    { mutation: true },
  );
}
export function DELETE(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor) =>
      deleteSiteEntry(
        tenant,
        actor,
        z.uuid().parse(new URL(request.url).searchParams.get("id")),
      ),
    "website.manage",
    { mutation: true },
  );
}
