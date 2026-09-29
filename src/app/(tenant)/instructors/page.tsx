import { TenantPeopleManager } from "@/app/_components/tenant-people-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function TenantInstructorsPage() {
  const { actor } = await requireTenantPage("instructor.read");
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">حساب‌های سازمان</div>
          <h1 className="page-title">مربیان</h1>
          <p className="page-description">
            حساب‌های مربیان سازمان و نقش‌های آن‌ها.
          </p>
        </div>
      </div>
      <TenantPeopleManager
        collection="instructors"
        canInvite={actor.permissions.has("instructor.create")}
        canReadRoles={actor.permissions.has("role.read")}
        canEdit={actor.permissions.has("instructor.update")}
        canAssign={actor.permissions.has("role.assign")}
        canSuspend={actor.permissions.has("instructor.suspend")}
        canDisable={false}
        defaultRole="instructor"
      />
    </main>
  );
}
