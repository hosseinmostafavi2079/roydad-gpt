import { getFinanceOverview } from "@/modules/payments/finance";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function FinanceOverviewPage() {
  const { tenant, actor } = await requireTenantPage("finance.read");
  const data = await getFinanceOverview({ tenant, actor });
  const cards = [
    ["پرداخت‌های موفق", data?.successful ?? 0],
    ["پرداخت‌های در انتظار", data?.pending ?? 0],
    ["پرداخت‌های ناموفق/منقضی", data?.failed ?? 0],
  ];
  const amountCards = [
    ...(data?.gross.length
      ? data.gross
      : [{ currency: "IRR", amount: "0" }]
    ).map(({ currency, amount }) => [
      "مبلغ ناخالص دریافت‌شده",
      `${amount} ${currency}`,
    ]),
    ...(data?.refunded.length
      ? data.refunded
      : [{ currency: "IRR", amount: "0" }]
    ).map(({ currency, amount }) => [
      "مبلغ بازپرداخت‌شده",
      `${amount} ${currency}`,
    ]),
  ];
  return (
    <section className="public-section">
      <h2>نمای کلی</h2>
      <div className="public-run-grid">
        {[...cards, ...amountCards].map(([label, value]) => (
          <article
            className="public-run-card public-run-body"
            key={`${label}-${value}`}
          >
            <h3>{label}</h3>
            <p>{value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
