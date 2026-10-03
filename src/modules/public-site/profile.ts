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
    .refine(
      (value) => URL.canParse(value) && new URL(value).protocol === "https:",
    ),
]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const imageUrl = z.union([
  safeUrl,
  z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
]);
export const sectionIds = [
  "hero",
  "featured",
  "upcoming",
  "about",
  "instructors",
  "stats",
  "contact",
  "social",
  "newsletter",
  "search",
  "categories",
  "whyUs",
  "testimonials",
  "gallery",
  "faq",
  "cta",
] as const;
const sectionId = z.enum(sectionIds);
const publicPath = z.string().regex(/^\/(?:$|[a-z0-9][a-z0-9\-/]*$)/);
const menuEntry = z.enum([
  "home",
  "events",
  "instructors",
  "about",
  "contact",
  "faq",
]);
export const siteSettingsInput = z.strictObject({
  template: z
    .enum(["MINIMAL", "ACADEMY", "PROFESSIONAL", "EVENT"])
    .default("ACADEMY"),
  surfaceColor: color.default("#ffffff"),
  contentWidth: z.enum(["COMPACT", "STANDARD", "WIDE"]).default("STANDARD"),
  spacing: z
    .enum(["COMPACT", "COMFORTABLE", "SPACIOUS"])
    .default("COMFORTABLE"),
  eventCardStyle: z.enum(["COMPACT", "VISUAL", "DETAILED"]).default("VISUAL"),
  menuOrder: z
    .array(menuEntry)
    .max(6)
    .refine((items) => new Set(items).size === items.length)
    .default(["home", "events", "instructors", "about", "contact", "faq"]),
  menuEnabled: z.record(menuEntry, z.boolean()).default({
    home: true,
    events: true,
    instructors: true,
    about: true,
    contact: true,
    faq: false,
  }),
  slogan: z.string().trim().max(160).default(""),
  heroTitle: z.string().trim().max(160).default(""),
  heroSubtitle: z.string().trim().max(500).default(""),
  heroCtaText: z.string().trim().max(80).default("مشاهده دوره‌ها"),
  heroCtaHref: z.enum(["/events", "/about", "/contact"]).default("/events"),
  heroAlignment: z.enum(["START", "CENTER"]).default("START"),
  heroLayout: z.enum(["SPLIT", "FULL", "CENTERED"]).default("SPLIT"),
  heroHeight: z.enum(["NORMAL", "TALL"]).default("NORMAL"),
  heroOverlay: z.enum(["NONE", "SOFT", "STRONG"]).default("NONE"),
  heroSecondaryText: z.string().trim().max(80).default(""),
  heroSecondaryHref: z.union([z.literal(""), publicPath]).default(""),
  sections: z.record(sectionId, z.boolean()).default({
    hero: true,
    featured: true,
    upcoming: false,
    about: true,
    instructors: false,
    stats: false,
    contact: true,
    social: false,
    newsletter: false,
    search: false,
    categories: false,
    whyUs: false,
    testimonials: false,
    gallery: false,
    faq: false,
    cta: false,
  }),
  sectionOrder: z
    .array(sectionId)
    .length(sectionIds.length)
    .refine((value) => new Set(value).size === sectionIds.length)
    .default([...sectionIds]),
  backgroundColor: color.default("#ffffff"),
  textColor: color.default("#172a2a"),
  fontPreset: z.enum(["VAZIRMATN", "TAHOMA"]).default("VAZIRMATN"),
  buttonStyle: z.enum(["SOLID", "OUTLINE"]).default("SOLID"),
  aboutTitle: z.string().trim().max(160).default(""),
  aboutImageUrl: imageUrl.default(""),
  foundingYear: z.number().int().min(1200).max(2100).nullable().default(null),
  features: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  stats: z
    .array(
      z.strictObject({
        value: z.string().trim().min(1).max(30),
        label: z.string().trim().min(1).max(80),
      }),
    )
    .max(4)
    .default([]),
  mapUrl: safeUrl.default(""),
  contactCtaText: z.string().trim().max(80).default("تماس با ما"),
  whatsappUrl: safeUrl.default(""),
  telegramUrl: safeUrl.default(""),
  seoTitle: z.string().trim().max(160).default(""),
  metaDescription: z.string().trim().max(300).default(""),
  socialImageUrl: imageUrl.default(""),
  ogTitle: z.string().trim().max(160).default(""),
  organizationDescription: z.string().trim().max(500).default(""),
  aboutStory: z.string().trim().max(3000).default(""),
  aboutMission: z.string().trim().max(1500).default(""),
  aboutVision: z.string().trim().max(1500).default(""),
  aboutValues: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  contactMapUrl: safeUrl.default(""),
  contactCtaHref: z.union([z.literal(""), publicPath]).default(""),
});
export type SiteSettings = z.infer<typeof siteSettingsInput>;
export const defaultSiteSettings = siteSettingsInput.parse({});

export function normalizeSiteSettings(value: unknown): SiteSettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const sections =
    input.sections &&
    typeof input.sections === "object" &&
    !Array.isArray(input.sections)
      ? (input.sections as Record<string, unknown>)
      : {};
  const order = Array.isArray(input.sectionOrder) ? input.sectionOrder : [];
  return siteSettingsInput.parse({
    ...defaultSiteSettings,
    ...input,
    sections: { ...defaultSiteSettings.sections, ...sections },
    sectionOrder: [...new Set([...order, ...sectionIds])],
    menuEnabled: {
      ...defaultSiteSettings.menuEnabled,
      ...(input.menuEnabled && typeof input.menuEnabled === "object"
        ? input.menuEnabled
        : {}),
    },
  });
}

export const websiteProfileInput = z.strictObject({
  displayName: z.string().trim().max(160),
  shortDescription: z.string().trim().max(500),
  about: z.string().trim().max(10000),
  logoUrl: imageUrl,
  coverUrl: imageUrl,
  faviconUrl: imageUrl,
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
  siteSettings: siteSettingsInput.default(defaultSiteSettings),
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
  siteSettings: "تنظیمات پیشرفته وب‌سایت",
};

export function parseWebsiteProfileInput(value: unknown): WebsiteProfile {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawSettings =
    input.siteSettings && typeof input.siteSettings === "object"
      ? (input.siteSettings as Record<string, unknown>)
      : {};
  const rawOrder = rawSettings.sectionOrder;
  if (Array.isArray(rawOrder) && new Set(rawOrder).size !== rawOrder.length)
    throw new DomainError("VALIDATION_FAILED", "ترتیب بخش‌ها تکراری است.");
  let settings: SiteSettings;
  try {
    settings = normalizeSiteSettings(input.siteSettings);
  } catch {
    throw new DomainError("VALIDATION_FAILED", "تنظیمات وب‌سایت نامعتبر است.");
  }
  const parsed = websiteProfileInput.safeParse({
    ...input,
    siteSettings: settings,
  });
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
  radius_style AS "radiusStyle", site_settings AS "siteSettings" FROM tenant_website_profiles WHERE tenant_id = $1`;

export async function getWebsiteProfile(
  tenant: TenantContext,
): Promise<WebsiteProfile> {
  const result = await getTenantPool(tenant).query<WebsiteProfile>(
    selectProfile,
    [tenant.tenantId],
  );
  if (!result.rows[0])
    throw new DomainError("NOT_FOUND", "Website profile not found.");
  return websiteProfileInput.parse({
    ...result.rows[0],
    siteSettings: normalizeSiteSettings(result.rows[0].siteSettings),
  });
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
       radius_style=$23, site_settings=$24::jsonb, updated_at=now() WHERE tenant_id=$1`,
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
        JSON.stringify(value.siteSettings),
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
