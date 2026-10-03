import type { Metadata } from "next";
import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { publicMetadata } from "@/modules/public-site/metadata";
import { listSiteEntries } from "@/modules/public-site/content";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { tenant, profile, origin } = await publicPageContext();
  return publicMetadata(tenant, profile, origin, "/faq", "سوالات متداول");
}
export default async function FaqPage() {
  const { tenant, profile } = await publicPageContext();
  const entries = await listSiteEntries(tenant, "FAQ");
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <h1>سوالات متداول</h1>
      </section>
      {entries.length ? (
        <div className="public-faq-list">
          {entries.map(
            (entry) =>
              entry.content.kind === "FAQ" && (
                <details key={entry.id}>
                  <summary>{entry.content.question}</summary>
                  <p>{entry.content.answer}</p>
                </details>
              ),
          )}
        </div>
      ) : (
        <p className="public-empty">هنوز پرسشی منتشر نشده است.</p>
      )}
    </PublicSiteShell>
  );
}
