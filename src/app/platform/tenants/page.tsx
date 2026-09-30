import Link from "next/link";
import { listTenants } from "@/modules/platform/tenants/service";
import { listTenantsSchema } from "@/modules/platform/tenants/schema";

export const metadata = { title: "سازمان‌ها" };

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = listTenantsSchema.parse({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status: params.status,
  });
  const tenants = await listTenants(query);
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">مدیریت مشتریان</div>
          <h1 className="page-title">سازمان‌ها</h1>
          <p className="page-description">
            پایگاه‌های داده، دامنه‌ها و تنظیمات هر سازمان را مدیریت کنید.
          </p>
        </div>
        <Link className="btn btn-primary" href="/platform/tenants/new">
          ＋ سازمان جدید
        </Link>
      </div>
      <section className="card">
        <div
          className="card-pad"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div>
            <strong>{tenants.total}</strong>
            <span className="muted"> سازمان ثبت‌شده</span>
          </div>
          <form className="inline-form" method="get">
            <div className="field">
              <label className="label" htmlFor="search">
                جست‌وجو
              </label>
              <input
                className="input"
                id="search"
                name="search"
                placeholder="نام یا شناسهٔ سازمان"
                defaultValue={query.search}
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-small">
              جست‌وجو
            </button>
          </form>
        </div>
        {tenants.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>سازمان</th>
                  <th>شناسه</th>
                  <th>طرح</th>
                  <th>وضعیت</th>
                  <th>دامنه</th>
                  <th>زمان ایجاد</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tenants.items.map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="table-name">
                      {tenant.displayName}
                      <span className="table-sub">{tenant.legalName}</span>
                    </td>
                    <td>
                      <code className="mono">{tenant.slug}</code>
                    </td>
                    <td>{tenant.plan.name}</td>
                    <td>
                      <StatusBadge status={tenant.status} />
                    </td>
                    <td className="mono">{tenant.primaryHostname ?? "—"}</td>
                    <td>
                      {new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
                        dateStyle: "medium",
                      }).format(new Date(tenant.createdAt))}
                    </td>
                    <td>
                      <Link
                        className="link"
                        href={`/platform/tenants/${tenant.id}`}
                      >
                        مدیریت ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">موردی مطابق جست‌وجو پیدا نشد.</div>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "ACTIVE"
      ? "badge-green"
      : status === "FAILED" || status === "SUSPENDED"
        ? "badge-red"
        : "badge-amber";
  const labels: Record<string, string> = {
    ACTIVE: "فعال",
    SUSPENDED: "معلق",
    FAILED: "ناموفق",
    PROVISIONING: "در حال راه‌اندازی",
  };
  return <span className={`badge ${classes}`}>{labels[status] ?? status}</span>;
}
