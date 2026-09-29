import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicSiteShell, formatDate } from "@/app/_components/public-site";
import { TenantSignOutButton } from "@/app/_components/tenant-sign-out-button";
import { listOwnEnrollments } from "@/modules/enrollment/repository";
import { requireTenantActor } from "@/modules/tenant-identity/request-auth";
import { publicPageContext } from "@/modules/public-site/page-context";
import { DomainError } from "@/shared/errors/domain-error";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "حساب من",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const { tenant, profile, origin } = await publicPageContext();
  let actor: Awaited<ReturnType<typeof requireTenantActor>>;
  try {
    actor = await requireTenantActor(tenant, origin, await headers());
  } catch (error) {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED")
      redirect("/login?participant=1");
    throw error;
  }
  const enrollments = await listOwnEnrollments({
    tenant,
    actor,
    requestId: "account-page",
  });
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">پنل شرکت‌کننده</span>
        <h1>سلام، {actor.name}</h1>
        <p>برنامه‌های ثبت‌نام‌شده شما در این مجموعه.</p>
      </section>
      <div className="public-account-actions">
        <span>{actor.email}</span>
        <TenantSignOutButton />
      </div>
      <section className="public-section">
        <h2>دوره‌های من</h2>
        {enrollments.length ? (
          <div className="public-run-grid">
            {enrollments.map((entry) => (
              <article
                className="public-run-card public-run-body"
                key={String(entry.id)}
              >
                <span className="public-eyebrow">
                  {formatDate(new Date(String(entry.starts_at)))}
                </span>
                <h3>
                  <Link href={`/events/${entry.run_id}`}>
                    {String(entry.title)}
                  </Link>
                </h3>
                <p>
                  {entry.status === "CONFIRMED"
                    ? "ثبت‌نام تأییدشده"
                    : entry.status === "WAITLISTED"
                      ? "در فهرست انتظار"
                      : `وضعیت: ${String(entry.status)}`}
                </p>
                <Link
                  className="public-text-link"
                  href={`/events/${entry.run_id}`}
                >
                  مشاهده برنامه ←
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="public-empty">
            هنوز در برنامه‌ای ثبت‌نام نکرده‌اید.{" "}
            <Link href="/events">برنامه‌ها را ببینید.</Link>
          </p>
        )}
      </section>
    </PublicSiteShell>
  );
}
