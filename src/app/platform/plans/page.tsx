import { listPlans } from "@/modules/platform/plans/service";
import { PlansManager } from "@/app/_components/plans-manager";

export const metadata = { title: "طرح‌ها و محدودیت‌ها" };

export default async function PlansPage() {
  const plans = await listPlans();
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">کنترل پلن‌ها</div>
          <h1 className="page-title">طرح‌ها و محدودیت‌ها</h1>
          <p className="page-description">
            قابلیت‌های پایه و سقف منابع سازمان‌ها را تنظیم کنید.
          </p>
        </div>
      </div>
      <div className="notice" style={{ marginBottom: 18 }}>
        طرح‌ها فقط پیکربندی پلتفرم را کنترل می‌کنند. قابلیت‌های عملیاتی محصول در
        مراحل بعدی پیاده‌سازی می‌شوند.
      </div>
      <PlansManager plans={plans} />
    </main>
  );
}
