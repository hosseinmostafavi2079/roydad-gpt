import type { Metadata } from "next";
import { PublicRunCard, PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { listPublicRuns } from "@/modules/public-site/repository";
import { publicMetadata } from "@/modules/public-site/metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { tenant, profile, origin } = await publicPageContext();
  return publicMetadata(
    tenant,
    profile,
    origin,
    "/events",
    "دوره‌ها و رویدادها",
  );
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenant, profile } = await publicPageContext();
  const query = (await searchParams).q || "";
  const runs = await listPublicRuns(tenant, query);
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">برنامه‌های مجموعه</span>
        <h1>دوره‌ها و رویدادها</h1>
        <p>برنامه مناسب خود را پیدا کنید.</p>
      </section>
      <form className="public-search" action="/events">
        <label htmlFor="public-search">جست‌وجوی برنامه</label>
        <div>
          <input
            id="public-search"
            name="q"
            defaultValue={query.slice(0, 80)}
            placeholder="نام دوره یا رویداد"
            maxLength={80}
          />
          <button type="submit">جست‌وجو</button>
        </div>
      </form>
      {runs.length ? (
        <div className="public-run-grid">
          {runs.map((run) => (
            <PublicRunCard key={run.id} run={run} />
          ))}
        </div>
      ) : (
        <p className="public-empty">برنامه‌ای با این مشخصات پیدا نشد.</p>
      )}
    </PublicSiteShell>
  );
}
