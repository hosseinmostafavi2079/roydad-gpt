import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantDetails } from "@/modules/platform/tenants/service";
import { listPlans } from "@/modules/platform/plans/service";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { TenantSettings } from "@/app/_components/tenant-settings";
import { TenantOwnerInviteForm } from "@/app/_components/tenant-owner-invite-form";

export const metadata = { title: "تنظیمات سازمان" };

export default async function TenantDetailsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId: rawId } = await params;
  const tenantId = tenantIdSchema.safeParse(rawId);
  if (!tenantId.success) notFound();
  const [initial, plans] = await Promise.all([
    getTenantDetails(tenantId.data),
    listPlans(),
  ]);
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Link className="link" href="/platform/tenants">
              سازمان‌ها
            </Link>{" "}
            / تنظیمات
          </div>
          <h1 className="page-title">{initial.tenant.displayName}</h1>
          <p className="page-description">
            <code className="mono">{initial.tenant.slug}</code> · مدیریت وضعیت،
            دامنه و تنظیمات محیط
          </p>
        </div>
        <Link className="btn btn-secondary" href="/platform/tenants">
          بازگشت به فهرست
        </Link>
      </div>
      <TenantSettings initial={initial} plans={plans} />
      {initial.tenant.status === "ACTIVE" && (
        <TenantOwnerInviteForm tenantId={tenantId.data} />
      )}
    </main>
  );
}
