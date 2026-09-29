import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { publicCanonical } from "@/modules/public-site/metadata";
import { listPublicRuns } from "@/modules/public-site/repository";
import { resolveTenantContext } from "@/modules/tenants/resolver";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  if (!host) return [];
  try {
    const tenant = await resolveTenantContext(host);
    if (!tenant.features.public_website) return [];
    const origin = `http://${host}`;
    const runs = await listPublicRuns(tenant);
    return ["/", "/events", "/about", "/contact"]
      .map((pathname) => ({ url: publicCanonical(tenant, origin, pathname) }))
      .concat(
        runs.map((run) => ({
          url: publicCanonical(tenant, origin, `/events/${run.slug}`),
          lastModified: run.startsAt,
        })),
      );
  } catch {
    return [];
  }
}
