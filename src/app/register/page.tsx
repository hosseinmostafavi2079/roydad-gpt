import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ParticipantRegisterForm } from "@/app/_components/participant-register-form";
import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ثبت‌نام",
  robots: { index: false, follow: false },
};

export default async function RegisterPage() {
  const { tenant, profile } = await publicPageContext();
  if (!tenant.features.registration || !tenant.features.password_login)
    notFound();
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">حساب شرکت‌کننده</span>
        <h1>ثبت‌نام در مجموعه</h1>
        <p>برای شرکت در برنامه‌ها یک حساب بسازید.</p>
      </section>
      <ParticipantRegisterForm />
      <p className="public-auth-help">
        حساب دارید؟ <Link href="/login?participant=1">وارد شوید</Link>
      </p>
    </PublicSiteShell>
  );
}
