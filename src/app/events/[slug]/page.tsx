import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PublicSiteShell,
  formatDate,
  formatTime,
} from "@/app/_components/public-site";
import { PublicEventArtwork } from "@/app/_components/public-event-artwork";
import { StructuredData } from "@/app/_components/structured-data";
import { PublicEnrollmentForm } from "@/app/_components/public-enrollment-form";
import { registrationFormSchema } from "@/modules/enrollment/form";
import { publicPageContext } from "@/modules/public-site/page-context";
import { listSiteEntries } from "@/modules/public-site/content";
import {
  getPublicRun,
  getPublicRunSessions,
  listPublicRuns,
} from "@/modules/public-site/repository";
import {
  publicCanonical,
  publicMetadata,
} from "@/modules/public-site/metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { tenant, profile, origin } = await publicPageContext();
    const run = await getPublicRun(tenant, (await params).slug);
    const metadata = publicMetadata(
      tenant,
      profile,
      origin,
      `/events/${run.slug}`,
      run.seoTitle ||
        `${run.title} | ${profile.displayName || tenant.branding.brandName}`,
      run.seoDescription || run.summary,
    );
    if (run.canonicalPath)
      metadata.alternates = {
        canonical: publicCanonical(tenant, origin, run.canonicalPath),
      };
    if (run.ogImageUrl)
      metadata.openGraph = {
        ...metadata.openGraph,
        images: [{ url: new URL(run.ogImageUrl, origin).toString() }],
      };
    return metadata;
  } catch {
    return { robots: { index: false } };
  }
}

export default async function EventDetailPage({ params }: Props) {
  const { tenant, profile, origin } = await publicPageContext();
  let run: Awaited<ReturnType<typeof getPublicRun>>;
  try {
    run = await getPublicRun(tenant, (await params).slug);
  } catch {
    notFound();
  }
  const form = registrationFormSchema.safeParse(run.registrationFormSchema);
  const [sessions, related, faqs] = await Promise.all([
    getPublicRunSessions(tenant, run.id),
    run.category
      ? listPublicRuns(tenant, "", { category: run.category })
      : Promise.resolve([]),
    profile.siteSettings.sections.faq
      ? listSiteEntries(tenant, "FAQ")
      : Promise.resolve([]),
  ]);
  const relatedRuns = related.filter((item) => item.id !== run.id).slice(0, 3);
  const now = Date.now();
  const open =
    run.endsAt.getTime() > now &&
    (!run.registrationStartsAt || run.registrationStartsAt.getTime() <= now) &&
    (!run.registrationEndsAt || run.registrationEndsAt.getTime() > now);
  const capacityFull = run.confirmedCount >= run.capacity;
  const canRegister =
    tenant.features.registration &&
    (BigInt(run.priceAmount) === 0n || tenant.features.payments) &&
    open &&
    (!capacityFull || (run.waitlistEnabled && tenant.features.waitlist)) &&
    form.success;
  const priceLabel =
    BigInt(run.priceAmount) === 0n
      ? "رایگان"
      : `${Number(run.priceAmount).toLocaleString("fa-IR")} ${run.priceCurrency}`;
  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: run.title,
    startDate: run.startsAt.toISOString(),
    endDate: run.endsAt.toISOString(),
    url: `${origin}/events/${run.slug}`,
    description: run.summary || undefined,
    eventAttendanceMode:
      run.deliveryMode === "ONLINE"
        ? "https://schema.org/OnlineEventAttendanceMode"
        : run.deliveryMode === "HYBRID"
          ? "https://schema.org/MixedEventAttendanceMode"
          : "https://schema.org/OfflineEventAttendanceMode",
    ...(run.venue ? { location: { "@type": "Place", name: run.venue } } : {}),
  };
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <StructuredData value={eventSchema} />
      <div className="public-detail">
        <div className="public-detail-main">
          <div className="public-event-intro">
            <div className="public-event-intro-copy">
              <Link href="/events" className="public-text-link">
                ← همه برنامه‌ها
              </Link>
              <span className="public-eyebrow">
                {run.category || (run.type === "COURSE" ? "دوره" : "رویداد")}
              </span>
              <h1>{run.title}</h1>
              {run.summary && <p className="public-lead">{run.summary}</p>}
              <div className="public-event-intro-facts">
                <span>
                  {formatDate(run.startsAt)} · {formatTime(run.startsAt)}
                </span>
                <span>
                  {run.deliveryMode === "ONLINE"
                    ? "آنلاین"
                    : run.deliveryMode === "HYBRID"
                      ? "ترکیبی"
                      : "حضوری"}
                </span>
                {run.instructor && <span>{run.instructor}</span>}
              </div>
            </div>
            <PublicEventArtwork
              src={run.coverUrl}
              title={run.title}
              category={run.category}
              type={run.type}
              eager
              className="public-event-cover"
            />
          </div>
          {run.videoUrl && (
            <section>
              <h2>ویدیوی معرفی</h2>
              {/* biome-ignore lint/a11y/useMediaCaption: Uploaded media has no caption asset in this product version. */}
              <video
                className="public-event-video"
                controls
                preload="metadata"
                src={run.videoUrl}
              />
            </section>
          )}
          {run.description && (
            <section>
              <h2>درباره برنامه</h2>
              <p>{run.description}</p>
            </section>
          )}
          {run.audience && (
            <section>
              <h2>مخاطبان</h2>
              <p>{run.audience}</p>
            </section>
          )}
          {run.objectives && (
            <section>
              <h2>اهداف</h2>
              <p>{run.objectives}</p>
            </section>
          )}
          {run.prerequisites && (
            <section>
              <h2>پیش‌نیازها</h2>
              <p>{run.prerequisites}</p>
            </section>
          )}
          {sessions.length > 0 && (
            <section>
              <h2>برنامه جلسات</h2>
              <ol className="public-session-list">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <strong>{session.title}</strong>
                    <span>
                      {formatDate(session.startsAt)} ·{" "}
                      {formatTime(session.startsAt)} تا{" "}
                      {formatTime(session.endsAt)}
                      {" · "}
                      {session.deliveryMode === "ONLINE"
                        ? "آنلاین"
                        : session.deliveryMode === "HYBRID"
                          ? "ترکیبی"
                          : "حضوری"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {run.instructorSlug && (
            <section className="public-event-instructor">
              <h2>مدرس</h2>
              <div className="public-instructor-summary">
                {run.instructorPhotoUrl && (
                  <img
                    src={run.instructorPhotoUrl}
                    alt={`تصویر ${run.instructor}`}
                    loading="lazy"
                  />
                )}
                <div>
                  <h3>{run.instructor}</h3>
                  {run.instructorTitle && <p>{run.instructorTitle}</p>}
                  {run.instructorShortBio && <p>{run.instructorShortBio}</p>}
                  {Boolean(run.instructorSpecialties?.length) && (
                    <p>{run.instructorSpecialties?.join(" · ")}</p>
                  )}
                  <Link
                    className="public-text-link"
                    href={`/instructors/${run.instructorSlug}`}
                  >
                    مشاهده رزومه کامل مدرس ←
                  </Link>
                </div>
              </div>
            </section>
          )}
          {run.venue && (
            <section>
              <h2>محل برگزاری</h2>
              <p>{run.venue}</p>
            </section>
          )}
          {canRegister && (
            <section className="public-detail-final-cta">
              <h2>برای حضور آماده‌اید؟</h2>
              <a className="public-button" href="#registration">
                ثبت‌نام در این برنامه
              </a>
            </section>
          )}
          {relatedRuns.length > 0 && (
            <section>
              <h2>برنامه‌های مرتبط</h2>
              <div className="public-run-grid">
                {relatedRuns.map((item) => (
                  <article className="public-run-card" key={item.id}>
                    <div className="public-run-body">
                      <h3>
                        <Link href={`/events/${item.slug}`}>{item.title}</Link>
                      </h3>
                      <p>{formatDate(item.startsAt)}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {faqs.length > 0 && (
            <section>
              <h2>سوالات متداول</h2>
              <div className="public-faq-list">
                {faqs.map(
                  (item) =>
                    item.content.kind === "FAQ" && (
                      <details key={item.id}>
                        <summary>{item.content.question}</summary>
                        <p>{item.content.answer}</p>
                      </details>
                    ),
                )}
              </div>
            </section>
          )}
        </div>
        <aside className="public-detail-aside" id="registration">
          <h2>اطلاعات برگزاری</h2>
          <dl>
            <dt>هزینه ثبت‌نام</dt>
            <dd>{priceLabel}</dd>
            <dt>آغاز</dt>
            <dd>{formatDate(run.startsAt)}</dd>
            <dt>پایان</dt>
            <dd>{formatDate(run.endsAt)}</dd>
            <dt>شیوه برگزاری</dt>
            <dd>
              {run.deliveryMode === "ONLINE"
                ? "آنلاین"
                : run.deliveryMode === "HYBRID"
                  ? "ترکیبی"
                  : "حضوری"}
            </dd>
            {run.venue && (
              <>
                <dt>مکان</dt>
                <dd>{run.venue}</dd>
              </>
            )}
            {run.instructor && (
              <>
                <dt>مدرس</dt>
                <dd>{run.instructor}</dd>
              </>
            )}
          </dl>
          {canRegister && form.success ? (
            <PublicEnrollmentForm
              runId={run.id}
              eventPath={`/events/${run.id}`}
              form={form.data}
              priceAmount={run.priceAmount}
              priceCurrency={run.priceCurrency}
            />
          ) : (
            <p className="public-empty">
              {!tenant.features.registration
                ? "ثبت‌نام این برنامه فعال نیست."
                : BigInt(run.priceAmount) > 0n && !tenant.features.payments
                  ? "پرداخت برای این مجموعه فعال نیست."
                  : !open
                    ? "زمان ثبت‌نام این برنامه به پایان رسیده یا هنوز آغاز نشده است."
                    : "ظرفیت این برنامه تکمیل شده است."}
            </p>
          )}
        </aside>
      </div>
      {canRegister && (
        <div className="public-mobile-register">
          <span>{priceLabel}</span>
          <a className="public-button" href="#registration">
            ثبت‌نام در دوره
          </a>
        </div>
      )}
    </PublicSiteShell>
  );
}
