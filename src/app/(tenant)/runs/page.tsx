import { RunsManager } from "@/app/_components/runs-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function RunsPage() {
  const { actor, tenant } = await requireTenantPage("program.read");
  return (
    <RunsManager
      timezone={tenant.timezone}
      canCreate={actor.permissions.has("program.create")}
      canEdit={actor.permissions.has("program.update")}
      canManage={actor.permissions.has("session.manage")}
      canPublish={actor.permissions.has("program.publish")}
      canAssign={actor.permissions.has("instructor.manage")}
      registrationEnabled={tenant.features.registration}
    />
  );
}
