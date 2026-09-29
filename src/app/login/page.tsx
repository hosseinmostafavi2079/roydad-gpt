import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { TenantSignInForm } from "@/app/_components/tenant-sign-in-form";
import { getTenantAuth } from "@/modules/tenant-identity/auth";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "ورود سازمان" };

export default async function TenantLoginPage() {
  const requestHeaders = await headers();
  let context: Awaited<ReturnType<typeof resolveTenantFromHeaders>>;
  try {
    context = await resolveTenantFromHeaders(requestHeaders);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const session = await getTenantAuth(
    context.tenant,
    context.origin,
  ).api.getSession({ headers: requestHeaders });
  if (session) redirect("/dashboard");
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
            ورود کاربران
          </div>
          <h1>به فضای سازمان خود خوش آمدید.</h1>
          <p>ورود امن به حساب سازمانی و ابزارهای مجاز شما.</p>
        </div>
        <div className="login-art-footer">EventOS · فضای سازمان</div>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <div className="eyebrow">ورود سازمانی</div>
          <h2>ورود به {context.tenant.branding.brandName}</h2>
          <p>از ایمیلی که برای حساب شما دعوت شده استفاده کنید.</p>
          <TenantSignInForm />
          <p className="hint" style={{ marginTop: 19, textAlign: "center" }}>
            برای دسترسی، از مدیر سازمان دعوت‌نامه دریافت کنید.
          </p>
        </div>
      </section>
    </main>
  );
}
