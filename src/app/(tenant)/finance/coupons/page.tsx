import { FinanceCouponForm } from "@/app/_components/finance-coupon-form";
import { listFinanceCoupons } from "@/modules/payments/finance";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function FinanceCouponsPage() {
  const { tenant, actor } = await requireTenantPage("finance.read");
  const coupons = await listFinanceCoupons({ tenant, actor });
  return (
    <section className="public-section">
      <h2>کدهای تخفیف</h2>
      {actor.permissions.has("payment.manage") && <FinanceCouponForm />}
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>کد</th>
              <th>نوع</th>
              <th>مقدار</th>
              <th>رزروشده</th>
              <th>مصرف‌شده</th>
              <th>آزادشده</th>
              <th>حداکثر</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((coupon) => (
              <tr key={coupon.id}>
                <td>{coupon.code}</td>
                <td>{coupon.discount_type}</td>
                <td>
                  {coupon.discount_value} {coupon.currency}
                </td>
                <td>{coupon.reserved_count}</td>
                <td>{coupon.used_count}</td>
                <td>{coupon.released_count}</td>
                <td>{coupon.max_uses ?? "بدون محدودیت"}</td>
                <td>{coupon.enabled ? "فعال" : "غیرفعال"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
