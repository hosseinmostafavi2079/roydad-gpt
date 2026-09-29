import { listTenantAudit } from "@/modules/tenant-identity/repository";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function TenantAuditPage() {
  const { tenant } = await requireTenantPage("audit.read");
  const entries = await listTenantAudit(tenant);
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">امنیت</div>
          <h1 className="page-title">گزارش امنیتی</h1>
          <p className="page-description">
            رویدادهای حساب و تغییر مجوزها به‌صورت فقط‌افزودنی ثبت می‌شوند.
          </p>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>زمان</th>
              <th>رویداد</th>
              <th>هدف</th>
              <th>شناسه درخواست</th>
            </tr>
          </thead>
          <tbody>
            {entries.length ? (
              entries.map(
                (entry: {
                  id: string;
                  created_at: Date;
                  action: string;
                  target_type: string;
                  target_id: string | null;
                  request_id: string;
                }) => (
                  <tr key={entry.id}>
                    <td>
                      {new Date(entry.created_at).toLocaleString("fa-IR")}
                    </td>
                    <td>{entry.action}</td>
                    <td>
                      {entry.target_type} · {entry.target_id ?? "—"}
                    </td>
                    <td className="mono">{entry.request_id}</td>
                  </tr>
                ),
              )
            ) : (
              <tr>
                <td className="empty" colSpan={4}>
                  هنوز رویدادی ثبت نشده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
