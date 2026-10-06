import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import { OwnerSetupForm } from "@/app/_components/owner-setup-form";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "راه‌اندازی مدیر اصلی",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};
export default async function OwnerSetupPage() {
  try {
    await resolveTenantFromHeaders(await headers());
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>راه‌اندازی مدیر اصلی</h1>
        <p>
          کد یک‌بارمصرف را از مدیر پلتفرم دریافت کنید و گذرواژه شخصی خود را تعیین
          کنید. این کد ۲۴ ساعت معتبر است.
        </p>
        <OwnerSetupForm />
      </section>
    </main>
  );
}
