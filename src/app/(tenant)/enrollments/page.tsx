import { notFound } from "next/navigation";
import { EnrollmentsManager } from "@/app/_components/enrollments-manager";
import { listManagedEnrollments } from "@/modules/enrollment/repository";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { listPublicRuns } from "@/modules/public-site/repository";

export default async function EnrollmentsPage() {
  const { tenant, actor } = await requireTenantPage("enrollment.read");
  if (!tenant.features.registration) notFound();
  const entries = await listManagedEnrollments({
    tenant,
    actor,
    requestId: "enrollments-page",
  });
  const runs = await listPublicRuns(tenant);
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">شرکت‌کنندگان</div>
          <h1 className="page-title">ثبت‌نام‌ها</h1>
          <p className="page-description">ثبت‌نام‌های برنامه‌های این مجموعه.</p>
        </div>
      </div>
      <EnrollmentsManager
        initial={entries.map((entry) => ({
          id: String(entry.id),
          name: String(entry.name),
          email: String(entry.email),
          run_title: String(entry.run_title),
          run_id: String(entry.run_id),
          status: String(entry.status),
          registered_at: new Date(String(entry.registered_at)).toISOString(),
        }))}
        canManage={actor.permissions.has("enrollment.manage")}
        runs={runs.map((run) => [run.id, run.title])}
      />
    </main>
  );
}
