import { TenantShell } from "@/app/_components/tenant-shell";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export const dynamic = "force-dynamic";

export default async function TenantLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { tenant, actor } = await requireTenantPage();
  return (
    <TenantShell tenant={tenant} actor={actor}>
      {children}
    </TenantShell>
  );
}
