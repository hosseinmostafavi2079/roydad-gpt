import type { Metadata } from "next";
import { PublicRunCard, PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import {
  listPublicRuns,
  listPublicCategories,
} from "@/modules/public-site/repository";
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
  searchParams: Promise<{
    q?: string;
    category?: string;
    type?: string;
    instructor?: string;
    period?: string;
    delivery?: string;
    price?: string;
    page?: string;
  }>;
}) {
  const { tenant, profile } = await publicPageContext();
  const filters = await searchParams;
  const query = filters.q || "";
  const page = Math.max(1, Math.min(100, Number(filters.page) || 1));
  const [runs, categories] = await Promise.all([
    listPublicRuns(tenant, query, { ...filters, page }),
    listPublicCategories(tenant),
  ]);
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">برنامه‌های مجموعه</span>
        <h1>دوره‌ها و رویدادها</h1>
        <p>برنامه مناسب خود را پیدا کنید.</p>
      </section>
      <search>
        <form className="public-search public-events-search" action="/events">
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
      </search>
      {categories.length > 0 && (
        <nav className="public-category-rail" aria-label="موضوعات برنامه‌ها">
          <a
            href="/events"
            aria-current={!filters.category ? "page" : undefined}
          >
            همه موضوعات
          </a>
          {categories.map((category) => (
            <a
              key={category}
              href={`/events?category=${encodeURIComponent(category)}`}
              aria-current={filters.category === category ? "page" : undefined}
            >
              {category}
            </a>
          ))}
        </nav>
      )}
      <details className="public-filter-panel">
        <summary>فیلتر برنامه‌ها</summary>
        <form className="public-event-filters" action="/events">
          {query && <input type="hidden" name="q" value={query.slice(0, 80)} />}
          <label>
            موضوع
            <select name="category" defaultValue={filters.category ?? ""}>
              <option value="">همه موضوعات</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            نوع
            <select name="type" defaultValue={filters.type ?? ""}>
              <option value="">همه</option>
              <option value="COURSE">دوره</option>
              <option value="EVENT">رویداد</option>
            </select>
          </label>
          <label>
            زمان
            <select name="period" defaultValue={filters.period ?? ""}>
              <option value="">همه</option>
              <option value="upcoming">پیش رو</option>
              <option value="past">گذشته</option>
            </select>
          </label>
          <label>
            مدرس
            <input
              name="instructor"
              maxLength={120}
              defaultValue={filters.instructor ?? ""}
            />
          </label>
          <label>
            شیوه برگزاری
            <select name="delivery" defaultValue={filters.delivery ?? ""}>
              <option value="">همه شیوه‌ها</option>
              <option value="ONLINE">آنلاین</option>
              <option value="IN_PERSON">حضوری</option>
              <option value="HYBRID">ترکیبی</option>
            </select>
          </label>
          <label>
            هزینه
            <select name="price" defaultValue={filters.price ?? ""}>
              <option value="">همه</option>
              <option value="free">رایگان</option>
              <option value="paid">غیررایگان</option>
            </select>
          </label>
          <button type="submit">اعمال فیلتر</button>
        </form>
      </details>
      <div className="public-results-heading">
        <h2>برنامه‌ها</h2>
        <span>{runs.length.toLocaleString("fa-IR")} برنامه در این صفحه</span>
      </div>
      {runs.length ? (
        <div
          className={`public-run-grid public-run-grid-count-${Math.min(runs.length, 3)}`}
        >
          {runs.map((run) => (
            <PublicRunCard
              key={run.id}
              run={run}
              preset={profile.siteSettings.eventCardStyle}
              showPaidPrice={tenant.features.payments}
            />
          ))}
        </div>
      ) : (
        <p className="public-empty">برنامه‌ای با این مشخصات پیدا نشد.</p>
      )}
      <nav className="public-pagination" aria-label="صفحه‌های رویدادها">
        {page > 1 && (
          <a
            href={`/events?${new URLSearchParams({ ...filters, page: String(page - 1) })}`}
          >
            صفحه قبل
          </a>
        )}
        {runs.length === 24 && (
          <a
            href={`/events?${new URLSearchParams({ ...filters, page: String(page + 1) })}`}
          >
            صفحه بعد
          </a>
        )}
      </nav>
    </PublicSiteShell>
  );
}
