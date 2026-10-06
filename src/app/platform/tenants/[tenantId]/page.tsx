import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantDetails } from "@/modules/platform/tenants/service";
import { listPlans } from "@/modules/platform/plans/service";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { TenantSettings } from "@/app/_components/tenant-settings";
import { TenantOwnerInviteForm } from "@/app/_components/tenant-owner-invite-form";
import { getTenantUsage } from "@/modules/platform/tenants/usage";
import { DomainError } from "@/shared/errors/domain-error";
import { TenantQuickActions } from "@/app/_components/tenant-quick-actions";
import { getServerConfig } from "@/shared/config/env";

import { OwnerBootstrapAccess } from "@/app/_components/owner-bootstrap-access";
import { ownerAccessAvailable } from "@/modules/tenant-identity/owner-bootstrap";

export const metadata = { title: "تنظیمات سازمان" };

export default async function TenantDetailsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId: rawId } = await params;
  const tenantId = tenantIdSchema.safeParse(rawId);
  if (!tenantId.success) notFound();
  let initial: Awaited<ReturnType<typeof getTenantDetails>>;
  try {
    initial = await getTenantDetails(tenantId.data);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    if (error instanceof DomainError && error.code === "PROVISIONING_FAILED") {
      console.error("Tenant control data is incomplete", {
        tenantId: tenantId.data,
      });
      return (
        <main className="content">
          <section className="card card-pad">
            <h1 className="page-title">اطلاعات سازمان ناقص است</h1>
            <p>اطلاعات زیرساخت این سازمان نیاز به بررسی دارد.</p>
            <Link className="btn btn-secondary" href="/platform/tenants">
              بازگشت به سازمان‌ها
            </Link>
          </section>
        </main>
      );
    }
    throw error;
  }
  const plans = await listPlans();
  const primaryHostname = initial.domains.find(
    (domain) => domain.isPrimary && domain.verifiedAt,
  )?.hostname;
  const origin = new URL(getServerConfig().BETTER_AUTH_URL);
  const siteUrl = primaryHostname
    ? `${origin.protocol}//${primaryHostname}${origin.port ? `:${origin.port}` : ""}`
    : "";
  const usage =
    initial.tenant.status === "ACTIVE"
      ? await getTenantUsage(tenantId.data)
      : null;
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
            <code className="mono">
              {primaryHostname ?? initial.tenant.slug}
            </code>{" "}
            · {initial.tenant.plan.name} ·{" "}
            {initial.tenant.status === "ACTIVE"
              ? "فعال"
              : initial.tenant.status === "FAILED"
                ? "خطا"
                : initial.tenant.status === "SUSPENDED"
                  ? "غیرفعال"
                  : "در حال راه‌اندازی"}
          </p>
        </div>
        <Link className="btn btn-secondary" href="/platform/tenants">
          بازگشت به فهرست
        </Link>
      </div>
      <section className="card card-pad section" id="tenant-health">
        <h2 className="card-title">
          {initial.tenant.status === "ACTIVE"
            ? "مجموعه آماده استفاده است ✓"
            : "وضعیت مجموعه"}
        </h2>
        <p>
          سلامت:{" "}
          {initial.database.state === "HEALTHY"
            ? "سالم"
            : initial.database.state === "DEGRADED"
              ? "نیازمند بررسی"
              : initial.database.state === "UNAVAILABLE" ||
                  initial.database.state === "FAILED"
                ? "خطا"
                : "در حال بررسی"}
        </p>
        {siteUrl && (
          <TenantQuickActions
            siteUrl={siteUrl}
            active={initial.tenant.status === "ACTIVE"}
          />
        )}
      </section>
      <OwnerBootstrapAccess
        tenantId={tenantId.data}
        siteUrl={siteUrl}
        available={await ownerAccessAvailable(tenantId.data)}
      />
      <div id="tenant-settings">
        <TenantSettings initial={initial} plans={plans} />
      </div>
      {usage && (
        <section className="card card-pad section">
          <h2 className="card-title">مصرف منابع</h2>
          <div className="usage-grid">
            {(
              [
                ["کارکنان", usage.staff, initial.limits.max_staff],
                [
                  "شرکت‌کنندگان",
                  usage.participants,
                  initial.limits.max_participants,
                ],
                ["مربیان", usage.instructors, initial.limits.max_instructors],
                ["برنامه‌ها", usage.programs, initial.limits.max_programs],
                [
                  "اجراهای منتشرشده",
                  usage.active_runs,
                  initial.limits.max_active_runs,
                ],
                ["جلسات", usage.sessions, null],
                ["ثبت‌نام‌های فعال", usage.enrollments, null],
                ["رکوردهای حضور", usage.attendance_records, null],
                ["گواهی‌های معتبر", usage.certificates_issued, null],
                ["گواهی‌های لغوشده", usage.certificates_revoked, null],
              ] as const
            ).map(([label, used, limit]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {used.toLocaleString("fa-IR")}
                  {limit === null || limit === undefined
                    ? ""
                    : ` / ${limit.toLocaleString("fa-IR")}`}
                </strong>
                {typeof limit === "number" && limit > 0 && (
                  <progress
                    max={limit}
                    value={Math.min(used, limit)}
                    aria-label={label}
                  />
                )}
              </div>
            ))}
            <div>
              <span>اندازه پایگاه داده</span>
              <strong>
                {(Number(usage.database_bytes) / (1024 * 1024)).toLocaleString(
                  "fa-IR",
                  { maximumFractionDigits: 1 },
                )}{" "}
                مگابایت
              </strong>
            </div>
            <div>
              <span>فضای PDF گواهی‌ها</span>
              <strong>
                {(
                  Number(usage.certificate_pdf_bytes) /
                  (1024 * 1024)
                ).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}{" "}
                مگابایت
              </strong>
            </div>
          </div>
        </section>
      )}
      {initial.tenant.status === "ACTIVE" && (
        <div id="owner-invitation">
          <TenantOwnerInviteForm tenantId={tenantId.data} />
        </div>
      )}
    </main>
  );
}
