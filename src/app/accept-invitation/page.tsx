import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { TenantInvitationForm } from "@/app/_components/tenant-invitation-form";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "فعال‌سازی حساب",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function AcceptTenantInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const requestHeaders = await headers();
  let context: Awaited<ReturnType<typeof resolveTenantFromHeaders>>;
  try {
    context = await resolveTenantFromHeaders(requestHeaders);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const { token } = await searchParams;
  const validToken = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
  return (
    <main className="login-page">
      <section className="login-art">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span className="brand-name">
            {context.tenant.branding.brandName}
            <span className="brand-caption">فضای امن سازمان</span>
          </span>
        </div>
        <div className="login-art-copy">
          <div className="eyebrow" style={{ color: "#e9c36d" }}>
            دعوت سازمانی
          </div>
          <h1>حساب خود را فعال کنید.</h1>
          <p>یک گذرواژهٔ امن برای ورود به سازمان بسازید.</p>
        </div>
        <div className="login-art-footer">EventOS · دعوت یک‌بارمصرف</div>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <div className="eyebrow">فعال‌سازی حساب</div>
          <h2>تکمیل دعوت‌نامه</h2>
          <p>پیوند یک‌بارمصرف است و پس از ۲۴ ساعت منقضی می‌شود.</p>
          {validToken ? (
            <TenantInvitationForm token={validToken} />
          ) : (
            <p className="alert alert-error" role="alert">
              پیوند فعال‌سازی معتبر نیست یا منقضی شده است.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
