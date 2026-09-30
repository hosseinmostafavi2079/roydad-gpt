import { redirect } from "next/navigation";
import { requirePlatformPageAdmin } from "@/infrastructure/auth/platform-session";
import { MfaEnrollment } from "@/app/_components/mfa-enrollment";
import { getServerConfig } from "@/shared/config/env";

export const metadata = { title: "امنیت حساب" };

export default async function MfaPage() {
  const actor = await requirePlatformPageAdmin({ allowMfaEnrollment: true });
  if (!getServerConfig().PLATFORM_REQUIRE_MFA) redirect("/platform");
  if (actor.twoFactorEnabled) redirect("/platform");
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">امنیت حساب</div>
          <h1 className="page-title">فعال‌سازی ورود دومرحله‌ای</h1>
          <p className="page-description">
            حساب مدیر پلتفرم باید با برنامهٔ احراز هویت محافظت شود.
          </p>
        </div>
      </div>
      <MfaEnrollment />
    </main>
  );
}
