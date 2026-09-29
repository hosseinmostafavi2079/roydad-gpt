import { TenantRolesManager } from "@/app/_components/tenant-roles-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function TenantRolesPage() {
  const { actor } = await requireTenantPage("role.read");
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">دسترسی‌ها</div>
          <h1 className="page-title">نقش‌ها و دسترسی‌ها</h1>
          <p className="page-description">
            هر نقش مجموعه‌ای مشخص از مجوزهای سازمانی دارد. تغییر نقش‌های سیستمی
            مجاز نیست.
          </p>
        </div>
      </div>
      <TenantRolesManager
        canCreate={actor.permissions.has("role.create")}
        canUpdate={actor.permissions.has("role.update")}
        canDelete={actor.permissions.has("role.delete")}
      />
    </main>
  );
}
