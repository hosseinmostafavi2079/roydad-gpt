import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { TenantAuthShell } from "@/app/_components/tenant-auth-shell";
import { TenantSignInForm } from "@/app/_components/tenant-sign-in-form";
import { ParticipantRegisterForm } from "@/app/_components/participant-register-form";
import { getTenantAuth } from "@/modules/tenant-identity/auth";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import {
  authContinuePath,
  safeParticipantDestination,
} from "@/modules/tenant-identity/auth-destination";
import { googleOAuthEnabledForOrigin } from "@/modules/tenant-identity/google-config";
import { getWebsiteProfile } from "@/modules/public-site/profile";
import {
  getIdentitySettings,
  smsAvailable,
} from "@/modules/tenant-identity/identity-v2-repository";
import { IdentityV2Login } from "@/app/_components/identity-v2-login";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "ورود یا ثبت‌نام",
  robots: { index: false, follow: false },
};

export default async function TenantLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string; participant?: string }>;
}) {
  const requestHeaders = await headers();
  let context: Awaited<ReturnType<typeof resolveTenantFromHeaders>>;
  try {
    context = await resolveTenantFromHeaders(requestHeaders);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const query = await searchParams;
  const next = safeParticipantDestination(query.next);
  const mode =
    query.mode === "register" && context.tenant.features.registration
      ? "register"
      : "login";
  const session = await getTenantAuth(
    context.tenant,
    context.origin,
  ).api.getSession({
    headers: requestHeaders,
  });
  if (session) redirect(authContinuePath(next));
  const profile = context.tenant.features.public_website
    ? await getWebsiteProfile(context.tenant)
    : null;
  const googleEnabled =
    context.tenant.features.google_login &&
    googleOAuthEnabledForOrigin(context.origin);
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";
  const identity = await getIdentitySettings(context.tenant);
  const methods = {
    ...identity.methods,
    sms_otp: await smsAvailable(context.tenant, identity),
    username_password:
      identity.methods.username_password &&
      context.tenant.features.password_login,
    email_password:
      identity.methods.email_password && context.tenant.features.password_login,
    email_otp: identity.methods.email_otp && context.tenant.features.email_otp,
    google: identity.methods.google && googleEnabled,
  };
  return (
    <TenantAuthShell
      brandName={context.tenant.branding.brandName}
      primaryColor={context.tenant.branding.primaryColor}
      logoUrl={profile?.logoUrl}
      welcomeText={profile?.shortDescription}
    >
      <nav className="tenant-auth-modes" aria-label="ورود یا ثبت‌نام">
        <Link
          aria-current={mode === "login" ? "page" : undefined}
          href={`/login?mode=login${nextQuery}`}
        >
          ورود
        </Link>
        {context.tenant.features.registration && (
          <Link
            aria-current={mode === "register" ? "page" : undefined}
            href={`/login?mode=register${nextQuery}`}
          >
            ثبت‌نام
          </Link>
        )}
      </nav>
      {!identity.mailAvailable && (
        <p className="hint">
          سرویس ایمیل در دسترس نیست. از روش‌های ورود فعال سازمان استفاده کنید.
        </p>
      )}
      {methods.sms_otp || methods.username_password ? (
        <IdentityV2Login
          methods={methods}
          fields={identity.fields}
          register={mode === "register"}
          next={next}
        />
      ) : mode === "register" ? (
        <ParticipantRegisterForm
          next={next ?? "/account"}
          passwordEnabled={methods.email_password}
          googleEnabled={methods.google}
        />
      ) : (
        <TenantSignInForm
          otpEnabled={methods.email_otp}
          passwordEnabled={methods.email_password}
          googleEnabled={methods.google}
          next={next}
        />
      )}
    </TenantAuthShell>
  );
}
