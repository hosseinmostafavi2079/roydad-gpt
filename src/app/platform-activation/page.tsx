import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlatformActivationForm } from "@/app/_components/platform-activation-form";
import { assertPlatformActivationHost } from "@/modules/platform/admins/activation-host";
export const metadata = { title: "فعال‌سازی مدیر پلتفرم" };
export const dynamic = "force-dynamic";
export default async function PlatformActivationPage() {
  try {
    assertPlatformActivationHost(await headers());
  } catch {
    notFound();
  }
  return (
    <main className="login-page" dir="rtl">
      <section
        className="login-form-side"
        style={{ gridColumn: "1 / -1", minWidth: 0 }}
      >
        <div
          className="login-card"
          style={{ width: "min(100%, 460px)", overflowWrap: "anywhere" }}
        >
          <div className="eyebrow">EventOS · مدیریت پلتفرم</div>
          <h1>فعال‌سازی حساب مدیر</h1>
          <p>
            ایمیل و کد دریافتی از مدیر پلتفرم را وارد کنید و رمز شخصی خود را
            بسازید.
          </p>
          <PlatformActivationForm />
        </div>
      </section>
    </main>
  );
}
