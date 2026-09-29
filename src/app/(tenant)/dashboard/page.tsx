import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function TenantDashboardPage() {
  const { tenant, actor } = await requireTenantPage("dashboard.read");
  const counts = await getTenantPool(tenant).query<{
    active_users: number;
    invited_users: number;
    active_roles: number;
  }>(
    `SELECT (SELECT count(*)::int FROM tenant_users WHERE "tenantId" = $1 AND status = 'ACTIVE') AS active_users,
            (SELECT count(*)::int FROM tenant_users WHERE "tenantId" = $1 AND status = 'INVITED') AS invited_users,
            (SELECT count(*)::int FROM tenant_roles WHERE tenant_id = $1) AS active_roles`,
    [tenant.tenantId],
  );
  const summary = counts.rows[0];
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">فضای سازمان</div>
          <h1 className="page-title">سلام {actor.name}</h1>
          <p className="page-description">
            وضعیت دسترسی‌ها و حساب‌های سازمان را از اینجا دنبال کنید.
          </p>
        </div>
      </div>
      <div className="grid grid-4">
        <section className="card stat-card">
          <span className="stat-label">حساب‌های فعال</span>
          <strong className="stat-value">{summary?.active_users ?? 0}</strong>
          <span className="stat-caption">کاربران فعال در این سازمان</span>
        </section>
        <section className="card stat-card">
          <span className="stat-label">دعوت‌های در انتظار</span>
          <strong className="stat-value">{summary?.invited_users ?? 0}</strong>
          <span className="stat-caption">پیوندهای فعال‌سازی ارسال‌شده</span>
        </section>
        <section className="card stat-card">
          <span className="stat-label">نقش‌های دسترسی</span>
          <strong className="stat-value">{summary?.active_roles ?? 0}</strong>
          <span className="stat-caption">قالب‌های سیستمی و سازمانی</span>
        </section>
        <section className="card stat-card">
          <span className="stat-label">وضعیت سازمان</span>
          <strong className="stat-value" style={{ fontSize: 20 }}>
            فعال
          </strong>
          <span className="stat-caption">پایگاه دادهٔ مستقل و آماده</span>
        </section>
      </div>
      <section className="card card-pad section">
        <h2 className="card-title">امنیت و دسترسی</h2>
        <p className="muted">
          دسترسی شما در هر درخواست از نقش‌های فعال در پایگاه دادهٔ این سازمان
          محاسبه می‌شود.
        </p>
        <div className="check-row">
          <span>سطح ورود</span>
          <span className="badge badge-green">{actor.authenticationLevel}</span>
        </div>
        <div className="check-row">
          <span>دسترسی‌های مؤثر</span>
          <span>{actor.permissions.size}</span>
        </div>
      </section>
    </main>
  );
}
