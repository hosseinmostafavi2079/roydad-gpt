import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/infrastructure/auth/auth";
import { SignInForm } from "@/app/_components/sign-in-form";
import { getServerConfig } from "@/shared/config/env";
import { notFound } from "next/navigation";

export const metadata = { title: "ورود مدیر پلتفرم" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const requestHeaders = await headers();
  if (
    requestHeaders.get("host")?.toLowerCase() !==
    new URL(getServerConfig().BETTER_AUTH_URL).host.toLowerCase()
  )
    notFound();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/platform");
  return (
    <main className="login-page">
      <section className="login-art" aria-label="معرفی EventOS">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span className="brand-name">
            EventOS
            <span className="brand-caption">مدیریت یکپارچهٔ رویدادها</span>
          </span>
        </div>
        <div className="login-art-copy">
          <div className="eyebrow" style={{ color: "#e9c36d" }}>
            پنل مدیریت پلتفرم
          </div>
          <h1>
            همهٔ سازمان‌ها،
            <br />
            در یک نمای روشن.
          </h1>
          <p>فضای امن مدیریت طرح‌ها، تنظیمات سازمان‌ها و سلامت سرویس EventOS.</p>
        </div>
        <div className="login-art-footer">EventOS Platform · نسخهٔ پایه</div>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <div className="eyebrow">خوش آمدید</div>
          <h2>ورود مدیر پلتفرم</h2>
          <p>برای ادامه، با حساب مدیریتی خود وارد شوید.</p>
          <SignInForm />
          <p className="hint" style={{ marginTop: 19, textAlign: "center" }}>
            دسترسی فقط برای مدیران پلتفرم فعال است.
          </p>
        </div>
      </section>
    </main>
  );
}
