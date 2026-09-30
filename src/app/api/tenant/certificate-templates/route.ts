import { listTemplates, saveTemplate } from "@/modules/certificates/repository";
import { templateInput } from "@/modules/certificates/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    ({ tenant }, actor, requestId) =>
      listTemplates({ tenant, actor, requestId }),
    undefined,
    { feature: "certificates" },
  );
}
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      saveTemplate(
        { tenant, actor, requestId },
        await parseJson(request, templateInput),
      ),
    "certificate.template.manage",
    { feature: "certificates", mutation: true },
  );
}
