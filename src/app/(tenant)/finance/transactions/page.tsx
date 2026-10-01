import { formatTenantDate } from "@/modules/program-core/dates";
import { listFinanceTransactions } from "@/modules/payments/finance";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function FinanceTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { tenant, actor } = await requireTenantPage("finance.read");
  const params = await searchParams;
  const transactions = await listFinanceTransactions(
    { tenant, actor },
    {
      status: one(params.status),
      runId: one(params.run),
      provider: one(params.provider),
      from: one(params.from),
      to: one(params.to),
    },
  );
  return (
    <section className="public-section">
      <h2>تراکنش‌ها</h2>
      <form method="get" className="public-register-form">
        <label>
          وضعیت{" "}
          <input
            name="status"
            defaultValue={one(params.status) ?? ""}
            placeholder="SUCCEEDED"
          />
        </label>
        <label>
          شناسه اجرا <input name="run" defaultValue={one(params.run) ?? ""} />
        </label>
        <label>
          درگاه{" "}
          <input name="provider" defaultValue={one(params.provider) ?? ""} />
        </label>
        <label>
          از تاریخ{" "}
          <input
            type="date"
            name="from"
            defaultValue={one(params.from) ?? ""}
          />
        </label>
        <label>
          تا تاریخ{" "}
          <input type="date" name="to" defaultValue={one(params.to) ?? ""} />
        </label>
        <button type="submit">اعمال فیلتر</button>
      </form>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>شرکت‌کننده</th>
              <th>اجرا</th>
              <th>مبلغ</th>
              <th>درگاه</th>
              <th>وضعیت</th>
              <th>مرجع</th>
              <th>تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {entry.participant_name}
                  <br />
                  <small>{entry.participant_email}</small>
                </td>
                <td>{entry.run_title}</td>
                <td>
                  {entry.payable_amount} {entry.currency}
                </td>
                <td>{entry.provider_key ?? "—"}</td>
                <td>{entry.state}</td>
                <td>{entry.provider_reference_id ?? "—"}</td>
                <td>{formatTenantDate(entry.created_at, tenant.timezone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!transactions.length && <p>تراکنشی یافت نشد.</p>}
    </section>
  );
}
