import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PublicSiteShell, formatDate } from "@/app/_components/public-site";
import { getOwnPayment, listOwnInvoices } from "@/modules/payments/finance";
import { requireTenantActor } from "@/modules/tenant-identity/request-auth";
import { publicPageContext } from "@/modules/public-site/page-context";
import { DomainError } from "@/shared/errors/domain-error";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "نتیجه پرداخت",
  robots: { index: false, follow: false },
};

export default async function ParticipantPaymentResultPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { tenant, profile, origin } = await publicPageContext();
  let actor: Awaited<ReturnType<typeof requireTenantActor>>;
  try {
    actor = await requireTenantActor(tenant, origin, await headers());
  } catch (error) {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED")
      redirect("/login?participant=1");
    throw error;
  }
  const { paymentId } = await params;
  let payment: Awaited<ReturnType<typeof getOwnPayment>>;
  try {
    payment = await getOwnPayment({ tenant, actor }, paymentId);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const invoices = await listOwnInvoices({ tenant, actor });
  const invoice = invoices.find((entry) => entry.payment_id === payment.id);
  const successful = ["SUCCEEDED", "REFUND_PENDING", "REFUNDED"].includes(
    payment.state,
  );
  const failed = ["FAILED", "EXPIRED", "CANCELLED"].includes(payment.state);
  const heading = successful
    ? "پرداخت موفق"
    : failed
      ? "پرداخت ناموفق"
      : "پرداخت در انتظار بررسی";
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">نتیجه پرداخت</span>
        <h1>{heading}</h1>
        <p>{payment.run_title}</p>
      </section>
      <section className="public-section">
        <p>
          مبلغ: {payment.payable_amount} {payment.currency}
        </p>
        <p>وضعیت ثبت‌نام: {payment.enrollment_status}</p>
        <p>تاریخ: {formatDate(payment.created_at)}</p>
        {successful && payment.enrollment_status === "EXPIRED" && (
          <p>
            پرداخت پس از پایان مهلت ثبت شده است. ثبت‌نام تأیید نشده؛ با
            برگزارکننده تماس بگیرید.
          </p>
        )}
        {invoice && (
          <p>
            <a href={`/api/tenant/payments/invoices/${invoice.id}/pdf`}>
              دریافت فاکتور {invoice.invoice_number}
            </a>
          </p>
        )}
        <Link href="/account">بازگشت به حساب من</Link>
      </section>
    </PublicSiteShell>
  );
}
