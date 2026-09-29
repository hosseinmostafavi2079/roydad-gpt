import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { publicMetadata } from "@/modules/public-site/metadata";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { tenant, profile, origin } = await publicPageContext();
  return publicMetadata(
    tenant,
    profile,
    origin,
    "/about",
    `درباره ${profile.displayName || tenant.branding.brandName}`,
    profile.shortDescription,
  );
}
export default async function AboutPage() {
  const { tenant, profile } = await publicPageContext();
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">آشنایی با مجموعه</span>
        <h1>درباره {profile.displayName || tenant.branding.brandName}</h1>
      </section>
      <article className="public-prose">
        {profile.about ||
          profile.shortDescription ||
          "اطلاعات این مجموعه به‌زودی منتشر می‌شود."}
      </article>
    </PublicSiteShell>
  );
}
