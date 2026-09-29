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
    profile.shortDescription ||
    `${title} در ${profile.displayName || tenant.branding.brandName}`;
  const canonical = publicCanonical(tenant, origin, pathname);
  return {
    title,
    description: summary,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "fa_IR",
      title,
      description: summary,
      url: canonical,
      ...(profile.coverUrl ? { images: [{ url: profile.coverUrl }] } : {}),
    },
  };
}
