import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicSiteShell } from "@/app/_components/public-site";
import { StructuredData } from "@/app/_components/structured-data";
import { publicPageContext } from "@/modules/public-site/page-context";
import {
  publicCanonical,
  publicMetadata,
} from "@/modules/public-site/metadata";
import { getPublicInstructor } from "@/modules/public-site/instructors";
import { listInstructorRuns } from "@/modules/public-site/repository";
import { PublicRunCard } from "@/app/_components/public-site";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { tenant, profile, origin } = await publicPageContext();
    const instructor = await getPublicInstructor(tenant, (await params).slug);
    const metadata = publicMetadata(
      tenant,
      profile,
      origin,
      `/instructors/${instructor.slug}`,
      instructor.seoTitle || instructor.name,
      instructor.metaDescription || instructor.shortBio,
    );
    if (instructor.canonicalPath)
      metadata.alternates = {
        canonical: publicCanonical(tenant, origin, instructor.canonicalPath),
      };
    return metadata;
  } catch {
    return { robots: { index: false } };
  }
}

export default async function PublicInstructorPage({ params }: Props) {
  const { tenant, profile, origin } = await publicPageContext();
  const instructor = await getPublicInstructor(
    tenant,
    (await params).slug,
  ).catch(() => notFound());
  const runs = await listInstructorRuns(tenant, instructor.id);
  const personSchema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: instructor.name,
    jobTitle: instructor.title || undefined,
    description: instructor.shortBio || undefined,
    url: `${origin}/instructors/${instructor.slug}`,
  };
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <StructuredData value={personSchema} />
      <article className="public-instructor-profile">
        <header className="public-page-header public-instructor-hero">
          {instructor.photoUrl && (
            <img src={instructor.photoUrl} alt={`تصویر ${instructor.name}`} />
          )}
          <div>
            <span className="public-eyebrow">مدرس</span>
            <h1>{instructor.name}</h1>
            {instructor.title && <p>{instructor.title}</p>}
            {instructor.specialties.length > 0 && (
              <p>{instructor.specialties.join(" · ")}</p>
            )}
            {instructor.yearsExperience !== null && (
              <p>
                {instructor.yearsExperience.toLocaleString("fa-IR")} سال تجربه
              </p>
            )}
          </div>
        </header>
        {instructor.biography && (
          <section className="public-section">
            <h2>درباره مدرس</h2>
            <p>{instructor.biography}</p>
          </section>
        )}
        {instructor.experience.length > 0 && (
          <section className="public-section">
            <h2>سوابق کاری</h2>
            <ul>
              {instructor.experience.map((item) => (
                <li key={item.id}>
                  <strong>{item.position}</strong> · {item.organization} ·{" "}
                  {item.startYear ?? ""}{" "}
                  {item.current
                    ? "تا کنون"
                    : item.endYear
                      ? `تا ${item.endYear}`
                      : ""}
                  {item.description && <p>{item.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {instructor.education.length > 0 && (
          <section className="public-section">
            <h2>تحصیلات</h2>
            <ul>
              {instructor.education.map((item) => (
                <li key={item.id}>
                  {item.degree} {item.field} · {item.institution}{" "}
                  {item.year ?? ""}
                </li>
              ))}
            </ul>
          </section>
        )}
        {(
          [
            ["گواهی‌ها", instructor.certifications],
            ["افتخارات", instructor.honors],
            ["کتاب‌ها", instructor.books],
            ["انتشارات", instructor.publications],
            ["پروژه‌ها", instructor.projects],
          ] as const
        ).map(([heading, items]) =>
          items.length ? (
            <section className="public-section" key={heading}>
              <h2>{heading}</h2>
              <ul>
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
        {(instructor.websiteUrl ||
          instructor.linkedInUrl ||
          instructor.resumeUrl) && (
          <section className="public-section">
            <h2>پیوندها</h2>
            <div className="public-instructor-links">
              {instructor.websiteUrl && (
                <a href={instructor.websiteUrl} rel="noopener noreferrer">
                  وب‌سایت شخصی
                </a>
              )}
              {instructor.linkedInUrl && (
                <a href={instructor.linkedInUrl} rel="noopener noreferrer">
                  لینکدین
                </a>
              )}
              {instructor.resumeUrl && (
                <a href={instructor.resumeUrl}>دریافت رزومه</a>
              )}
            </div>
          </section>
        )}
        {runs.length > 0 && (
          <section className="public-section">
            <h2>دوره‌ها و رویدادهای مدرس</h2>
            <div className="public-run-grid">
              {runs.map((run) => (
                <PublicRunCard key={run.id} run={run} />
              ))}
            </div>
          </section>
        )}
        <Link className="public-text-link" href="/instructors">
          ← همه مدرسان
        </Link>
      </article>
    </PublicSiteShell>
  );
}
