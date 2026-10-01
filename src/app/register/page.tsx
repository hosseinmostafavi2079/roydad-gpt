import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ParticipantRegisterForm } from "@/app/_components/participant-register-form";
import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { googleOAuthEnabledForOrigin } from "@/modules/tenant-identity/google-config";
import {
  safeParticipantDestination,
  participantLoginPath,
} from "@/modules/tenant-identity/auth-destination";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ثبت‌نام",
  robots: { index: false, follow: false },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { tenant, profile, origin } = await publicPageContext();
  const googleEnabled = googleOAuthEnabledForOrigin(origin);
  const next =
    safeParticipantDestination((await searchParams).next) ?? "/account";
  if (
    !tenant.features.registration ||
    (!tenant.features.password_login && !googleEnabled)
  )
    notFound();
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">حساب شرکت‌کننده</span>
        <h1>ثبت‌نام در مجموعه</h1>
        <p>برای شرکت در برنامه‌ها یک حساب بسازید.</p>
      </section>
      <ParticipantRegisterForm
        next={next}
        passwordEnabled={tenant.features.password_login}
        googleEnabled={googleEnabled}
      />
      <p className="public-auth-help">
        حساب دارید؟ <Link href={participantLoginPath(next)}>وارد شوید</Link>
      </p>
    </PublicSiteShell>
  );
}
