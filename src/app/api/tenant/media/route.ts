import { z } from "zod";
import { saveMedia, removeMedia } from "@/modules/media/repository";
import { mediaKind, mediaKinds } from "@/modules/media/validation";
import { DomainError } from "@/shared/errors/domain-error";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 51 * 1024 * 1024;

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const length = Number(request.headers.get("content-length"));
      if (!Number.isFinite(length) || length <= 0 || length > MAX_REQUEST_BYTES)
        throw new DomainError(
          "VALIDATION_FAILED",
          "اندازه درخواست رسانه مجاز نیست.",
        );
      const kind = mediaKind(new URL(request.url).searchParams.get("kind"));
      const resourceId =
        kind.startsWith("PROGRAM_") ||
        kind.startsWith("INSTRUCTOR_") ||
        kind === "WEBSITE_GALLERY"
          ? z
              .uuid()
              .parse(
                new URL(request.url).searchParams.get("resourceId") ??
                  new URL(request.url).searchParams.get("programId"),
              )
          : tenant.tenantId;
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new DomainError(
          "VALIDATION_FAILED",
          "فایل رسانه انتخاب نشده است.",
        );
      if (file.size > mediaKinds[kind].maxBytes || file.size === 0)
        throw new DomainError(
          "VALIDATION_FAILED",
          "اندازه فایل رسانه مجاز نیست.",
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      return saveMedia(
        tenant,
        actor,
        kind,
        resourceId,
        file.type,
        bytes,
        requestId,
      );
    },
    undefined,
    { mutation: true },
  );
}

export function DELETE(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const url = new URL(request.url);
      const kind = mediaKind(url.searchParams.get("kind"));
      const resourceId =
        kind.startsWith("PROGRAM_") ||
        kind.startsWith("INSTRUCTOR_") ||
        kind === "WEBSITE_GALLERY"
          ? z
              .uuid()
              .parse(
                url.searchParams.get("resourceId") ??
                  url.searchParams.get("programId"),
              )
          : tenant.tenantId;
      return removeMedia(tenant, actor, kind, resourceId, requestId);
    },
    undefined,
    { mutation: true },
  );
}
