import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicSiteShell, formatDate } from "@/app/_components/public-site";
import { PublicEnrollmentForm } from "@/app/_components/public-enrollment-form";
import { registrationFormSchema } from "@/modules/enrollment/form";
import { publicPageContext } from "@/modules/public-site/page-context";
import { getPublicRun } from "@/modules/public-site/repository";
import { publicMetadata } from "@/modules/public-site/metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { tenant, profile, origin } = await publicPageContext();
    const run = await getPublicRun(tenant, (await params).slug);
    return publicMetadata(
      tenant,
      profile,
      origin,
      `/events/${run.slug}`,
      `${run.title} | ${profile.displayName || tenant.branding.brandName}`,
      run.summary,
    );
  } catch {
    return { robots: { index: false } };
  }
}

export default async function EventDetailPage({ params }: Props) {
  const { tenant, profile } = await publicPageContext();
  let run: Awaited<ReturnType<typeof getPublicRun>>;
  try {
    run = await getPublicRun(tenant, (await params).slug);
  } catch {
    notFound();
  }
  const form = registrationFormSchema.safeParse(run.registrationFormSchema);
  const now = Date.now();
  const open =
    run.endsAt.getTime() > now &&
    (!run.registrationStartsAt || run.registrationStartsAt.getTime() <= now) &&
    (!run.registrationEndsAt || run.registrationEndsAt.getTime() > now);
  const capacityFull = run.confirmedCount >= run.capacity;
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <div className="public-detail">
        <div className="public-detail-main">
          {run.coverUrl && (
            <img
              className="public-event-cover"
              src={run.coverUrl}
              alt={`تصویر شاخص ${run.title}`}
            />
          )}
          <Link href="/events" className="public-text-link">
            ← همه برنامه‌ها
          </Link>
          <span className="public-eyebrow">
            {run.type === "COURSE" ? "دوره" : "رویداد"}
          </span>
          <h1>{run.title}</h1>
          <p className="public-lead">{run.summary}</p>
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
          <section>
            <h2>درباره برنامه</h2>
            <p>{run.description || "توضیحات این برنامه به‌زودی تکمیل می‌شود."}</p>
          </section>
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
        </div>
        <aside className="public-detail-aside">
          <h2>اطلاعات برگزاری</h2>
          <dl>
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
          {tenant.features.registration &&
          open &&
          (!capacityFull ||
            (run.waitlistEnabled && tenant.features.waitlist)) &&
          form.success ? (
            <PublicEnrollmentForm runId={run.id} form={form.data} />
          ) : (
            <p className="public-empty">
              {!tenant.features.registration
                ? "ثبت‌نام این برنامه فعال نیست."
                : !open
                  ? "زمان ثبت‌نام این برنامه به پایان رسیده یا هنوز آغاز نشده است."
                  : "ظرفیت این برنامه تکمیل شده است."}
            </p>
          )}
        </aside>
      </div>
    </PublicSiteShell>
  );
}
