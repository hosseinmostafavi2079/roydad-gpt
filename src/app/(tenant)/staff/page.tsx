import { TenantPeopleManager } from "@/app/_components/tenant-people-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function TenantStaffPage() {
  const { actor } = await requireTenantPage("staff.read");
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">حساب‌های سازمان</div>
          <h1 className="page-title">کارکنان</h1>
          <p className="page-description">
            دعوت کارکنان، نقش‌ها و وضعیت دسترسی آن‌ها را مدیریت کنید.
          </p>
        </div>
      </div>
      <TenantPeopleManager
        collection="staff"
        canInvite={actor.permissions.has("staff.create")}
        canReadRoles={actor.permissions.has("role.read")}
        canEdit={actor.permissions.has("staff.update")}
        canAssign={actor.permissions.has("role.assign")}
        canSuspend={actor.permissions.has("staff.suspend")}
        canDisable={actor.permissions.has("staff.delete")}
        defaultRole="organization_admin"
      />
    </main>
  );
}
