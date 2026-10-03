import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { publicCanonical } from "@/modules/public-site/metadata";
import { listPublicRuns } from "@/modules/public-site/repository";
import { listPublicInstructors } from "@/modules/public-site/instructors";
import { listInformationPages } from "@/modules/public-site/content";
import { resolveTenantContext } from "@/modules/tenants/resolver";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  if (!host) return [];
  try {
    const tenant = await resolveTenantContext(host);
    if (!tenant.features.public_website) return [];
    const origin = `http://${host}`;
    const [runs, instructors, pages] = await Promise.all([
      listPublicRuns(tenant),
      listPublicInstructors(tenant),
      listInformationPages(tenant),
    ]);
    return ["/", "/events", "/instructors", "/about", "/contact", "/faq"]
      .map((pathname) => ({ url: publicCanonical(tenant, origin, pathname) }))
      .concat(
        runs.map((run) => ({
          url: publicCanonical(tenant, origin, `/events/${run.slug}`),
          lastModified: run.startsAt,
        })),
        instructors.map((instructor) => ({
          url: publicCanonical(
            tenant,
            origin,
            `/instructors/${instructor.slug}`,
          ),
        })),
        pages.map((page) => ({
          url: publicCanonical(tenant, origin, `/pages/${page.slug}`),
        })),
      );
  } catch {
    return [];
  }
}
