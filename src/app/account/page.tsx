import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicSiteShell, formatDate } from "@/app/_components/public-site";
import { TenantSignOutButton } from "@/app/_components/tenant-sign-out-button";
import { listOwnEnrollments } from "@/modules/enrollment/repository";
import { listOwnAttendance } from "@/modules/attendance/repository";
import { listCertificates } from "@/modules/certificates/repository";
import { listOwnInvoices, listOwnPayments } from "@/modules/payments/finance";
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
  const scope = { tenant, actor, requestId: "account-page" };
  const attendance =
    tenant.features.attendance && actor.permissions.has("attendance.self.read")
      ? await listOwnAttendance(scope)
      : null;
  const certificates =
    tenant.features.certificates &&
    actor.permissions.has("certificate.self.read")
      ? await listCertificates(scope, true)
      : [];
  const [payments, invoices] = tenant.features.payments
    ? await Promise.all([listOwnPayments(scope), listOwnInvoices(scope)])
    : [[], []];
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">پنل شرکت‌کننده</span>
        <h1>سلام، {actor.name}</h1>
        <p>برنامه‌های ثبت‌نام‌شده شما در این مجموعه.</p>
      </section>
      {tenant.features.payments && (
        <>
          <section className="public-section">
            <h2>پرداخت‌های من</h2>
            <ul>
              {payments.map((payment) => (
                <li key={payment.id}>
                  <Link href={`/account/payments/${payment.id}`}>
                    {payment.run_title}
                  </Link>
                  {" · "}
                  {payment.payable_amount} {payment.currency} · {payment.state}
                </li>
              ))}
            </ul>
            {!payments.length && <p>پرداختی ثبت نشده است.</p>}
          </section>
          <section className="public-section">
            <h2>فاکتورهای من</h2>
            <ul>
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  {invoice.invoice_number}
                  {" · "}
                  <a href={`/api/tenant/payments/invoices/${invoice.id}/pdf`}>
                    دریافت PDF
                  </a>
                </li>
              ))}
            </ul>
            {!invoices.length && <p>فاکتوری ثبت نشده است.</p>}
          </section>
        </>
      )}
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
      {attendance ? (
        <section className="public-section">
          <h2>حضور من</h2>
          <p>
            حضور در {attendance.summary.attended} جلسه از{" "}
            {attendance.summary.total} جلسه · {attendance.summary.percentage}٪
          </p>
          {tenant.features.qr_attendance &&
          actor.permissions.has("attendance.checkin") ? (
            <Link href="/check-in">ثبت حضور با QR</Link>
          ) : null}
          <ul>
            {attendance.records.map((record) => (
              <li key={record.id}>
                {record.title} · {record.run_title} ·{" "}
                {record.status ?? "ثبت نشده"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {certificates.length ? (
        <section className="public-section">
          <h2>گواهی‌های من</h2>
          <ul>
            {certificates.map((certificate) => (
              <li key={certificate.id}>
                {certificate.program_name} · {certificate.serial_number} ·{" "}
                {certificate.status === "ACTIVE" ? (
                  <a href={`/api/tenant/certificates/${certificate.id}/pdf`}>
                    دریافت PDF
                  </a>
                ) : (
                  "لغوشده"
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PublicSiteShell>
  );
}
