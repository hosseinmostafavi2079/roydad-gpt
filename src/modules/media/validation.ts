import { DomainError } from "@/shared/errors/domain-error";

export const mediaKinds = {
  PROGRAM_COVER: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  PROGRAM_VIDEO: { types: ["video/mp4"], maxBytes: 50 * 1024 * 1024 },
  WEBSITE_LOGO: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  WEBSITE_FAVICON: {
    types: ["image/png", "image/webp"],
    maxBytes: 1024 * 1024,
  },
  WEBSITE_HERO: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  WEBSITE_ABOUT: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  WEBSITE_SOCIAL: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  WEBSITE_GALLERY: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  INSTRUCTOR_PHOTO: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 5 * 1024 * 1024,
  },
  INSTRUCTOR_RESUME: { types: ["application/pdf"], maxBytes: 10 * 1024 * 1024 },
} as const;
export type MediaKind = keyof typeof mediaKinds;

export function mediaKind(value: string | null): MediaKind {
  if (value && Object.hasOwn(mediaKinds, value)) return value as MediaKind;
  throw new DomainError("VALIDATION_FAILED", "نوع رسانه نامعتبر است.");
}

export function validateMedia(
  kind: MediaKind,
  mime: string,
  bytes: Uint8Array,
): void {
  const rule = mediaKinds[kind];
  if (
    !rule.types.some((type) => type === mime) ||
    bytes.length === 0 ||
    bytes.length > rule.maxBytes
  )
    throw new DomainError(
      "VALIDATION_FAILED",
      "نوع یا اندازه فایل رسانه مجاز نیست.",
    );
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  const valid =
    mime === "image/jpeg"
      ? starts(0xff, 0xd8, 0xff)
      : mime === "image/png"
        ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        : mime === "image/webp"
          ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          : mime === "video/mp4"
            ? String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
            : mime === "application/pdf"
              ? starts(0x25, 0x50, 0x44, 0x46, 0x2d)
              : false;
  if (!valid)
    throw new DomainError("VALIDATION_FAILED", "محتوای فایل رسانه معتبر نیست.");
}

export function mediaObjectKey(
  tenantId: string,
  kind: MediaKind,
  resourceId: string,
  randomId: string,
): string {
  const group = kind.startsWith("PROGRAM_")
    ? "programs"
    : kind.startsWith("INSTRUCTOR_")
      ? "instructors"
      : "website";
  return `tenants/${tenantId}/${group}/${resourceId}/${randomId}`;
}
