import { FinanceRefundForm } from "@/app/_components/finance-refund-form";
import { formatTenantDate } from "@/modules/program-core/dates";
import {
  listFinanceRefunds,
  listFinanceTransactions,
} from "@/modules/payments/finance";
import { listPaymentProviders } from "@/modules/payments/registry";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function FinanceRefundsPage() {
  const { tenant, actor } = await requireTenantPage("finance.read");
  const [refunds, transactions] = await Promise.all([
    listFinanceRefunds({ tenant, actor }),
    actor.permissions.has("refund.manage")
      ? listFinanceTransactions({ tenant, actor }, { status: "SUCCEEDED" })
      : Promise.resolve([]),
  ]);
  const capabilities = new Map(
    listPaymentProviders().map((provider) => [
      provider.key,
      provider.capabilities.supportsRefund,
    ]),
  );
  return (
    <section className="public-section">
      <h2>بازپرداخت‌ها</h2>
      {actor.permissions.has("refund.manage") && (
        <div>
          <h3>ثبت بازپرداخت</h3>
          {transactions.map(
            (entry) =>
              entry.paid_amount !== "0" && (
                <article
                  key={entry.id}
                  className="public-run-card public-run-body"
                >
                  <p>
                    {entry.participant_name} · {entry.run_title} ·{" "}
                    {entry.paid_amount} {entry.currency}
                  </p>
                  <FinanceRefundForm
                    paymentId={entry.id}
                    amount={entry.paid_amount}
                    method={
                      capabilities.get(entry.provider_key ?? "")
                        ? "PROVIDER"
                        : "MANUAL"
                    }
                  />
                </article>
              ),
          )}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>شرکت‌کننده</th>
              <th>روش</th>
              <th>مبلغ</th>
              <th>وضعیت</th>
              <th>دلیل</th>
              <th>مرجع</th>
              <th>تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.participant_name}</td>
                <td>{entry.method === "PROVIDER" ? "درگاه" : "دستی"}</td>
                <td>
                  {entry.amount} {entry.currency}
                </td>
                <td>{entry.status}</td>
                <td>{entry.reason}</td>
                <td>{entry.reference ?? "—"}</td>
                <td>{formatTenantDate(entry.created_at, tenant.timezone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
