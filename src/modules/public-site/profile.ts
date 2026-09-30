import "server-only";

import { z } from "zod";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";

const safeUrl = z.union([
  z.literal(""),
  z
    .url()
    .max(2048)
    .refine((value) => new URL(value).protocol === "https:"),
]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const websiteProfileInput = z.strictObject({
  displayName: z.string().trim().max(160),
  shortDescription: z.string().trim().max(500),
  about: z.string().trim().max(10000),
  logoUrl: safeUrl,
  coverUrl: safeUrl,
  faviconUrl: safeUrl,
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.email().max(320)]),
  address: z.string().trim().max(500),
  websiteUrl: safeUrl,
  socialUrl: safeUrl,
  contactHours: z.string().trim().max(200),
  footerDescription: z.string().trim().max(500),
  primaryColor: color,
  secondaryColor: color,
  accentColor: color,
  heroEnabled: z.boolean(),
  featuredEnabled: z.boolean(),
  aboutEnabled: z.boolean(),
  contactEnabled: z.boolean(),
  cardStyle: z.enum(["SOFT", "OUTLINED"]),
  radiusStyle: z.enum(["SMALL", "MEDIUM", "LARGE"]),
});

export type WebsiteProfile = z.infer<typeof websiteProfileInput>;

const websiteFieldNames: Record<string, string> = {
  displayName: "نام نمایشی",
  shortDescription: "معرفی کوتاه",
  about: "درباره مجموعه",
  logoUrl: "نشانی لوگو",
  coverUrl: "نشانی تصویر اصلی",
  faviconUrl: "نشانی نشان مرورگر",
  phone: "تلفن",
  email: "ایمیل",
  address: "نشانی",
  websiteUrl: "نشانی وب‌سایت",
  socialUrl: "شبکه اجتماعی",
  contactHours: "ساعت پاسخ‌گویی",
  footerDescription: "متن پایین صفحه",
  primaryColor: "رنگ اصلی",
  secondaryColor: "رنگ دوم",
  accentColor: "رنگ تأکیدی",
  heroEnabled: "نمایش معرفی",
  featuredEnabled: "نمایش برنامه‌ها",
  aboutEnabled: "نمایش درباره ما",
  contactEnabled: "نمایش راه‌های ارتباطی",
  cardStyle: "سبک کارت",
  radiusStyle: "گردی گوشه‌ها",
};

export function parseWebsiteProfileInput(value: unknown): WebsiteProfile {
  const parsed = websiteProfileInput.safeParse(value);
  if (parsed.success) return parsed.data;
  const path = String(parsed.error.issues[0]?.path[0] ?? "اطلاعات وب‌سایت");
  throw new DomainError(
    "VALIDATION_FAILED",
    `مقدار «${websiteFieldNames[path] ?? "اطلاعات وب‌سایت"}» نامعتبر است.`,
  );
}

const selectProfile = `SELECT display_name AS "displayName", short_description AS "shortDescription",
  about, logo_url AS "logoUrl", cover_url AS "coverUrl", favicon_url AS "faviconUrl",
  phone, email, address, website_url AS "websiteUrl", social_url AS "socialUrl",
  contact_hours AS "contactHours", footer_description AS "footerDescription",
  primary_color AS "primaryColor", secondary_color AS "secondaryColor",
  accent_color AS "accentColor", hero_enabled AS "heroEnabled",
  featured_enabled AS "featuredEnabled", about_enabled AS "aboutEnabled",
  contact_enabled AS "contactEnabled", card_style AS "cardStyle",
  radius_style AS "radiusStyle" FROM tenant_website_profiles WHERE tenant_id = $1`;

export async function getWebsiteProfile(
  tenant: TenantContext,
): Promise<WebsiteProfile> {
  const result = await getTenantPool(tenant).query<WebsiteProfile>(
    selectProfile,
    [tenant.tenantId],
  );
  if (!result.rows[0])
    throw new DomainError("NOT_FOUND", "Website profile not found.");
  return websiteProfileInput.parse(result.rows[0]);
}

export async function updateWebsiteProfile(
  tenant: TenantContext,
  actor: TenantActor,
  input: WebsiteProfile,
  requestId: string,
): Promise<WebsiteProfile> {
  if (actor.tenantId !== tenant.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(actor.permissions, "website.manage");
  const value = parseWebsiteProfileInput(input);
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE tenant_website_profiles SET display_name=$2, short_description=$3, about=$4,
       logo_url=$5, cover_url=$6, favicon_url=$7, phone=$8, email=$9, address=$10,
       website_url=$11, social_url=$12, contact_hours=$13, footer_description=$14,
       primary_color=$15, secondary_color=$16, accent_color=$17, hero_enabled=$18,
       featured_enabled=$19, about_enabled=$20, contact_enabled=$21, card_style=$22,
       radius_style=$23, updated_at=now() WHERE tenant_id=$1`,
      [
        tenant.tenantId,
        value.displayName,
        value.shortDescription,
        value.about,
        value.logoUrl,
        value.coverUrl,
        value.faviconUrl,
        value.phone,
        value.email,
        value.address,
        value.websiteUrl,
        value.socialUrl,
        value.contactHours,
        value.footerDescription,
        value.primaryColor,
        value.secondaryColor,
        value.accentColor,
        value.heroEnabled,
        value.featuredEnabled,
        value.aboutEnabled,
        value.contactEnabled,
        value.cardStyle,
        value.radiusStyle,
      ],
    );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id, actor_id, action, target_type, target_id, request_id)
       VALUES ($1,$2,'website.updated','WEBSITE',$4,$3)`,
      [tenant.tenantId, actor.id, requestId, tenant.tenantId],
    );
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
