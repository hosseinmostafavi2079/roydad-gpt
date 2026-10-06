import Link from "next/link";
import { listPlans } from "@/modules/platform/plans/service";
import { TenantCreateForm } from "@/app/_components/tenant-create-form";
import { getServerConfig } from "@/shared/config/env";

import { emailServiceAvailable } from "@/infrastructure/auth/mailer";

export const metadata = { title: "ایجاد سازمان" };

export default async function NewTenantPage() {
  const plans = await listPlans();
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Link className="link" href="/platform/tenants">
              سازمان‌ها
            </Link>{" "}
            / ایجاد
          </div>
          <h1 className="page-title">ثبت سازمان جدید</h1>
          <p className="page-description">
            سازمان و محیط مستقل آن را برای مشتری تازه آماده کنید.
          </p>
        </div>
      </div>
      <section className="card card-pad" style={{ maxWidth: 850 }}>
        <TenantCreateForm
          mailAvailable={emailServiceAvailable()}
          plans={plans}
          platformDomain={getServerConfig().PLATFORM_BASE_DOMAIN}
        />
      </section>
    </main>
  );
}
