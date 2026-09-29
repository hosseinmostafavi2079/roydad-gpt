import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { publicCanonical } from "@/modules/public-site/metadata";
import { resolveTenantContext } from "@/modules/tenants/resolver";

export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  if (!host) return { rules: { userAgent: "*", disallow: "/" } };
  try {
    const tenant = await resolveTenantContext(host);
    if (!tenant.features.public_website) throw new Error("Site disabled");
    const origin = `http://${host}`;
    return {
      rules: {
        userAgent: "*",
        allow: ["/", "/events", "/about", "/contact"],
        disallow: [
          "/api/",
          "/account",
          "/login",
          "/register",
          "/dashboard",
          "/platform",
          "/website",
          "/enrollments",
          "/settings",
          "/staff",
          "/roles",
          "/runs",
          "/sessions",
        ],
      },
      sitemap: publicCanonical(tenant, origin, "/sitemap.xml"),
    };
  } catch {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
}
