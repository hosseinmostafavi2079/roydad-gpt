import { ProgramsManager } from "@/app/_components/programs-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function ProgramsPage() {
  const { actor } = await requireTenantPage("program.read");
  return (
    <ProgramsManager
      canCreate={actor.permissions.has("program.create")}
      canEdit={actor.permissions.has("program.update")}
      canPublish={actor.permissions.has("program.publish")}
      canArchive={actor.permissions.has("program.delete")}
    />
  );
}
