import { SessionsManager } from "@/app/_components/sessions-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function SessionsPage() {
  const { actor, tenant } = await requireTenantPage("session.read");
  return (
    <SessionsManager
      timezone={tenant.timezone}
      canManage={actor.permissions.has("session.manage")}
      canAssign={actor.permissions.has("instructor.manage")}
    />
  );
}
