import { TenantPeopleManager } from "@/app/_components/tenant-people-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import Link from "next/link";

export default async function TenantInstructorsPage() {
  const { actor, tenant } = await requireTenantPage("instructor.read");
  const instructors = actor.permissions.has("instructor.update")
    ? (
        await getTenantPool(tenant).query<{
          user_id: string;
          display_name: string;
        }>(
          "SELECT user_id,display_name FROM tenant_instructor_profiles WHERE tenant_id=$1 ORDER BY display_name LIMIT 100",
          [tenant.tenantId],
        )
      ).rows
    : [];
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
      {instructors.length > 0 && (
        <section className="card card-pad section">
          <h2 className="card-title">پروفایل‌های عمومی مدرسان</h2>
          <ul>
            {instructors.map((item) => (
              <li key={item.user_id}>
                <Link
                  href={`/manage/instructors/${encodeURIComponent(item.user_id)}`}
                >
                  ویرایش پروفایل عمومی {item.display_name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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
