import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

const items = [
  ["/finance", "نمای کلی"],
  ["/finance/transactions", "تراکنش‌ها"],
  ["/finance/invoices", "فاکتورها"],
  ["/finance/coupons", "کدهای تخفیف"],
  ["/finance/refunds", "بازپرداخت‌ها"],
  ["/finance/settings", "تنظیمات پرداخت"],
] as const;

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { tenant } = await requireTenantPage("finance.read");
  if (!tenant.features.payments) notFound();
  return (
    <main className="content" dir="rtl">
      <div className="page-heading">
        <div>
          <div className="eyebrow">عملیات / امور مالی</div>
          <h1 className="page-title">امور مالی</h1>
          <p className="page-description">
            پرداخت‌ها، فاکتورها و بازپرداخت‌های این مجموعه.
          </p>
        </div>
      </div>
      <nav aria-label="بخش‌های امور مالی" className="public-account-actions">
        {items.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
