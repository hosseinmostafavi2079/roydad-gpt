import { TenantPeopleManager } from "@/app/_components/tenant-people-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function TenantParticipantsPage() {
  const { actor } = await requireTenantPage("participant.read");
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">حساب‌های سازمان</div>
          <h1 className="page-title">شرکت‌کنندگان</h1>
          <p className="page-description">
            دعوت شرکت‌کنندگان و مدیریت وضعیت حساب‌های آن‌ها.
          </p>
        </div>
      </div>
      <TenantPeopleManager
        collection="participants"
        canInvite={actor.permissions.has("participant.create")}
        canReadRoles={actor.permissions.has("role.read")}
        canEdit={actor.permissions.has("participant.update")}
        canAssign={actor.permissions.has("role.assign")}
        canSuspend={actor.permissions.has("participant.suspend")}
        canDisable={false}
        defaultRole="participant"
      />
    </main>
  );
}
