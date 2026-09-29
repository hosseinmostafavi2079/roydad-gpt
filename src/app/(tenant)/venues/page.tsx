import { VenuesManager } from "@/app/_components/venues-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function VenuesPage() {
  const { actor } = await requireTenantPage("settings.read");
  return <VenuesManager canManage={actor.permissions.has("settings.manage")} />;
}
