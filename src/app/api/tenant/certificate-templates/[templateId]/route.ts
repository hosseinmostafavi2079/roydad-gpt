import { z } from "zod";
import { saveTemplate } from "@/modules/certificates/repository";
import { templateInput } from "@/modules/certificates/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { templateId } = await context.params;
      return saveTemplate(
        { tenant, actor, requestId },
        await parseJson(request, templateInput),
        z.uuid().parse(templateId),
      );
    },
    "certificate.template.manage",
    { feature: "certificates", mutation: true },
  );
}
