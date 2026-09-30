import { z } from "zod";
import { saveTemplateBackground } from "@/modules/certificates/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const length = Number(request.headers.get("content-length"));
      if (!Number.isFinite(length) || length <= 0 || length > 6 * 1024 * 1024)
        throw new DomainError("VALIDATION_FAILED", "اندازه تصویر مجاز نیست.");
      const { templateId } = await context.params;
      const file = (await request.formData()).get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > 5 * 1024 * 1024
      )
        throw new DomainError(
          "VALIDATION_FAILED",
          "تصویر معتبر انتخاب نشده است.",
        );
      return saveTemplateBackground(
        { tenant, actor, requestId },
        z.uuid().parse(templateId),
        file.type,
        new Uint8Array(await file.arrayBuffer()),
      );
    },
    "certificate.template.manage",
    { feature: "certificates", mutation: true },
  );
}
