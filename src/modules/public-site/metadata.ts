import type { Metadata } from "next";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { WebsiteProfile } from "./profile";

export function publicCanonical(
  tenant: TenantContext,
  origin: string,
  pathname: string,
): string {
  const current = new URL(origin);
  const local =
    tenant.primaryHostname === "localhost" ||
    tenant.primaryHostname.endsWith(".localhost");
  return new URL(
    pathname,
    `${local ? "http" : "https"}://${tenant.primaryHostname}${local ? (current.port ? `:${current.port}` : "") : ""}`,
  ).toString();
}

export function publicMetadata(
  tenant: TenantContext,
  profile: WebsiteProfile,
  origin: string,
  pathname: string,
  title: string,
  description?: string,
): Metadata {
  const summary =
    description ||
    profile.siteSettings.metaDescription ||
    profile.shortDescription ||
    `${title} در ${profile.displayName || tenant.branding.brandName}`;
  const canonical = publicCanonical(tenant, origin, pathname);
  const image = profile.siteSettings.socialImageUrl || profile.coverUrl;
  return {
    title: profile.siteSettings.seoTitle || title,
    description: summary,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "fa_IR",
      title: profile.siteSettings.ogTitle || title,
      description: summary,
      url: canonical,
      ...(image
        ? { images: [{ url: new URL(image, origin).toString() }] }
        : {}),
    },
  };
}
