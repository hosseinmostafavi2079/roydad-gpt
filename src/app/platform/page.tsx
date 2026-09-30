import Link from "next/link";
import { listTenants } from "@/modules/platform/tenants/service";
import { listPlans } from "@/modules/platform/plans/service";
import { getServerConfig } from "@/shared/config/env";

export const metadata = { title: "نمای کلی" };

export default async function PlatformHome() {
  const [tenants, plans] = await Promise.all([
    listTenants({ page: 1, pageSize: 100 }),
    listPlans(),
  ]);
  const active = tenants.items.filter(
    (tenant) => tenant.status === "ACTIVE",
  ).length;
  const provisioning = tenants.items.filter(
    (tenant) => tenant.status === "PROVISIONING",
  ).length;
  const failed = tenants.items.filter(
    (tenant) => tenant.status === "FAILED",
  ).length;
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">نمای کلی</div>
          <h1 className="page-title">به پنل EventOS خوش آمدید</h1>
          <p className="page-description">
            وضعیت سازمان‌ها و زیرساخت پلتفرم را در یک نگاه ببینید.
          </p>
        </div>
        <Link className="btn btn-primary" href="/platform/tenants/new">
          <span aria-hidden="true">＋</span> سازمان جدید
        </Link>
      </div>
      <section className="grid grid-4" aria-label="خلاصهٔ وضعیت">
        <article className="card stat-card">
          <span className="stat-label">کل سازمان‌ها</span>
          <strong className="stat-value">{tenants.total}</strong>
          <span className="stat-caption">همهٔ محیط‌های ثبت‌شده</span>
        </article>
        <article className="card stat-card">
          <span className="stat-label">سازمان‌های فعال</span>
          <strong className="stat-value">{active}</strong>
          <span className="stat-caption">آمادهٔ استفاده از سرویس</span>
        </article>
        <article className="card stat-card">
          <span className="stat-label">در حال راه‌اندازی</span>
          <strong className="stat-value">{provisioning}</strong>
          <span className="stat-caption">پایگاه داده در حال آماده‌سازی</span>
        </article>
        <article className="card stat-card">
          <span className="stat-label">نیازمند بررسی</span>
          <strong className="stat-value">{failed}</strong>
          <span className="stat-caption">
            راه‌اندازی ناموفق یا نیازمند تلاش دوباره
          </span>
        </article>
      </section>
      <section className="section card">
        <div className="card-pad section-header">
          <div>
            <h2>سازمان‌های اخیر</h2>
            <p>آخرین محیط‌های ثبت‌شده در پلتفرم</p>
          </div>
          <Link className="link" href="/platform/tenants">
            مشاهدهٔ همه
          </Link>
        </div>
        {tenants.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>سازمان</th>
                  <th>طرح</th>
                  <th>وضعیت</th>
                  <th>دامنهٔ اصلی</th>
                  <th>تاریخ ایجاد</th>
                </tr>
              </thead>
              <tbody>
                {tenants.items.slice(0, 6).map((tenant) => (
                  <tr key={tenant.id}>
                    <td>
                      <Link
                        className="table-name link"
                        href={`/platform/tenants/${tenant.id}`}
                      >
                        {tenant.displayName}
                        <span className="table-sub">{tenant.slug}</span>
                      </Link>
                    </td>
                    <td>{tenant.plan.name}</td>
                    <td>
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="mono">{tenant.primaryHostname ?? "—"}</td>
                    <td>
                      {new Intl.DateTimeFormat("fa-IR", {
                        dateStyle: "medium",
                      }).format(new Date(tenant.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            هنوز سازمانی ثبت نشده است. برای شروع، نخستین سازمان را بسازید.
          </div>
        )}
      </section>
      <section className="section grid grid-2">
        <article className="card card-pad">
          <div className="section-header">
            <div>
              <h2>طرح‌های دسترس‌پذیر</h2>
              <p>مدیریت قابلیت‌ها و سقف استفادهٔ هر طرح</p>
            </div>
            <Link className="link" href="/platform/plans">
              مدیریت طرح‌ها
            </Link>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {plans
              .filter((plan) => plan.isActive)
              .map((plan) => (
                <span className="badge badge-green" key={plan.id}>
                  {plan.name}
                </span>
              ))}
          </div>
        </article>
        {getServerConfig().PLATFORM_REQUIRE_MFA && (
          <article className="card card-pad">
            <div className="section-header">
              <div>
                <h2>امنیت حساب مدیر</h2>
                <p>حساب‌های مدیریتی با احراز هویت دو‌مرحله‌ای محافظت می‌شوند.</p>
              </div>
              <Link
                className="btn btn-secondary btn-small"
                href="/platform/security/mfa"
              >
                تنظیم امنیت
              </Link>
            </div>
            <div className="notice">
              نشست‌های مدیریتی کوتاه‌مدت هستند و عملیات حساس در گزارش ممیزی ثبت
              می‌شوند.
            </div>
          </article>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusClass =
    status === "ACTIVE"
      ? "badge-green"
      : status === "FAILED" || status === "SUSPENDED"
        ? "badge-red"
        : "badge-amber";
  const label =
    status === "ACTIVE"
      ? "فعال"
      : status === "SUSPENDED"
        ? "معلق"
        : status === "FAILED"
          ? "ناموفق"
          : "در حال راه‌اندازی";
  return <span className={`badge ${statusClass}`}>{label}</span>;
}
