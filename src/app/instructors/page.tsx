import type { Metadata } from "next";
import Link from "next/link";
import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { publicMetadata } from "@/modules/public-site/metadata";
import { listPublicInstructors } from "@/modules/public-site/instructors";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { tenant, profile, origin } = await publicPageContext();
  return publicMetadata(tenant, profile, origin, "/instructors", "مدرسان");
}

export default async function PublicInstructorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenant, profile } = await publicPageContext();
  const page = Math.max(
    1,
    Math.min(100, Number((await searchParams).page) || 1),
  );
  const instructors = await listPublicInstructors(tenant, page);
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">چهره‌های آموزشی</span>
        <h1>مدرسان</h1>
      </section>
      {instructors.length ? (
        <div className="public-run-grid">
          {instructors.map((item) => (
            <article className="public-run-card" key={item.id}>
              {item.photoUrl && (
                <img
                  className="public-instructor-photo"
                  src={item.photoUrl}
                  alt={`تصویر ${item.name}`}
                  loading="lazy"
                />
              )}
              <div className="public-run-body">
                <h2>
                  <Link href={`/instructors/${item.slug}`}>{item.name}</Link>
                </h2>
                {item.title && <p>{item.title}</p>}
                {item.shortBio && <p>{item.shortBio}</p>}
                {item.specialties.length > 0 && (
                  <p>{item.specialties.join(" · ")}</p>
                )}
                <Link
                  className="public-text-link"
                  href={`/instructors/${item.slug}`}
                >
                  مشاهده رزومه مدرس ←
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="public-empty">هنوز پروفایل مدرس منتشر نشده است.</p>
      )}
      <nav className="public-pagination" aria-label="صفحه‌های مدرسان">
        {page > 1 && (
          <Link href={`/instructors?page=${page - 1}`}>صفحه قبل</Link>
        )}
        {instructors.length === 24 && (
          <Link href={`/instructors?page=${page + 1}`}>صفحه بعد</Link>
        )}
      </nav>
    </PublicSiteShell>
  );
}
