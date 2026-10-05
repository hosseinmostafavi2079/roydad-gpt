import { TenantPeopleManager } from "@/app/_components/tenant-people-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";

export default async function TenantInstructorsPage() {
  const { actor, tenant } = await requireTenantPage("instructor.read");
  const instructors = (
    await getTenantPool(tenant).query<{
      user_id: string;
      slug: string | null;
      published: boolean | null;
      title: string | null;
      specialties: string[] | null;
      photo_url: string | null;
    }>(
      `SELECT profile.user_id,public.slug,public.published,public.content->>'title' AS title,
        CASE WHEN jsonb_typeof(public.content->'specialties')='array'
          THEN ARRAY(SELECT jsonb_array_elements_text(public.content->'specialties')) ELSE ARRAY[]::text[] END AS specialties,
        public.content->>'photoUrl' AS photo_url
       FROM tenant_instructor_profiles AS profile
       LEFT JOIN tenant_instructor_public_profiles AS public ON public.tenant_id=profile.tenant_id AND public.user_id=profile.user_id
       WHERE profile.tenant_id=$1 ORDER BY profile.display_name LIMIT 100`,
      [tenant.tenantId],
    )
  ).rows;
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">حساب‌های سازمان</div>
          <h1 className="page-title">مدرسان</h1>
          <p className="page-description">
            دعوت، مدیریت حساب و انتشار رزومه عمومی مدرسان.
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
        profileSummaries={instructors.map((item) => ({
          userId: item.user_id,
          title: item.title ?? "",
          specialties: item.specialties ?? [],
          photoUrl: item.photo_url ?? "",
          slug: item.slug ?? "",
          published: item.published ?? false,
        }))}
      />
    </main>
  );
}
