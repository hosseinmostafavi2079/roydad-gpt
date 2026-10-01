import { formatTenantDate } from "@/modules/program-core/dates";
import { listFinanceInvoices } from "@/modules/payments/finance";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function FinanceInvoicesPage() {
  const { tenant, actor } = await requireTenantPage("finance.read");
  const invoices = await listFinanceInvoices({ tenant, actor });
  return (
    <section className="public-section">
      <h2>فاکتورها</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>شماره فاکتور</th>
              <th>شرکت‌کننده</th>
              <th>مبلغ پرداختی</th>
              <th>وضعیت</th>
              <th>تاریخ</th>
              <th>دریافت</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.invoice_number}</td>
                <td>{invoice.participant_name}</td>
                <td>
                  {invoice.paid_amount} {invoice.currency}
                </td>
                <td>{invoice.payment_state}</td>
                <td>{formatTenantDate(invoice.issued_at, tenant.timezone)}</td>
                <td>
                  <a href={`/api/tenant/payments/invoices/${invoice.id}/pdf`}>
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!invoices.length && <p>فاکتوری ثبت نشده است.</p>}
    </section>
  );
}
