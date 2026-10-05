import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { IdentitySettingsEditor } from "@/app/_components/identity-settings-editor";
import { IdentityAccountMethods } from "@/app/_components/identity-account-methods";

const featureNames: Record<string, string> = {
  public_website: "وب‌سایت عمومی",
  registration: "ثبت‌نام",
  waitlist: "فهرست انتظار",
  password_login: "ورود با رمز عبور",
  email_otp: "ورود با کد ایمیلی",
  google_login: "ورود با گوگل",
  courses: "دوره‌ها",
  events: "رویدادها",
  attendance: "حضور و غیاب",
  qr_attendance: "حضور با QR",
  payments: "پرداخت‌ها",
  certificates: "گواهی‌ها",
  quiz: "آزمون‌ها",
  assignments: "تکالیف",
  crm: "مدیریت کاربران",
  sms: "پیامک",
  email: "ایمیل",
  ai: "هوش مصنوعی",
  custom_domain: "دامنهٔ اختصاصی",
  branches: "شعبه‌ها",
};

export default async function TenantSettingsPage() {
  const { tenant, actor } = await requireTenantPage("settings.read");
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">سازمان</div>
          <h1 className="page-title">تنظیمات سازمان</h1>
          <p className="page-description">
            اطلاعات هویتی، دامنه و قابلیت‌های فعال سازمان.
          </p>
        </div>
      </div>
      <IdentitySettingsEditor
        editable={actor.permissions.has("settings.manage")}
      />
      <div className="detail-grid">
        <IdentityAccountMethods />
        <section className="card card-pad">
          <h2 className="card-title">مشخصات</h2>
          <div className="check-row">
            <span>نام سازمان</span>
            <strong>{tenant.branding.brandName}</strong>
          </div>
          <div className="check-row">
            <span>شناسه</span>
            <span className="mono">{tenant.slug}</span>
          </div>
          <div className="check-row">
            <span>دامنهٔ فعال</span>
            <span className="mono">{tenant.hostname}</span>
          </div>
          <div className="check-row">
            <span>منطقهٔ زمانی</span>
            <span>{tenant.timezone}</span>
          </div>
          <div className="check-row">
            <span>زبان</span>
            <span>{tenant.locale}</span>
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="card-title">قابلیت‌ها</h2>
          {Object.entries(tenant.features).map(([key, enabled]) => (
            <div className="check-row" key={key}>
              <span>{featureNames[key] ?? key}</span>
              <span
                className={`badge ${enabled ? "badge-green" : "badge-gray"}`}
              >
                {enabled ? "فعال" : "غیرفعال"}
              </span>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
