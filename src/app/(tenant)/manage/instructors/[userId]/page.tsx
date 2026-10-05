import { notFound } from "next/navigation";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import {
  getAdminInstructorProfile,
  type InstructorContent,
} from "@/modules/public-site/instructors";
import { InstructorProfileWorkspace } from "@/app/_components/instructor-profile-workspace";

export default async function InstructorPublicProfileEditorPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { tenant, actor } = await requireTenantPage("instructor.update");
  const { userId } = await params;
  const privateProfile = await getTenantPool(tenant).query<{
    display_name: string;
    bio: string;
    specialties: string[];
  }>(
    "SELECT display_name,bio,specialties FROM tenant_instructor_profiles WHERE tenant_id=$1 AND user_id=$2",
    [tenant.tenantId, userId],
  );
  const privateRow = privateProfile.rows[0];
  if (!privateRow) notFound();
  const existing = await getAdminInstructorProfile(tenant, actor, userId);
  const empty: InstructorContent = {
    name: privateRow.display_name,
    title: "",
    shortBio: privateRow.bio.slice(0, 500),
    biography: "",
    specialties: privateRow.specialties,
    yearsExperience: null,
    experience: [],
    education: [],
    certifications: [],
    honors: [],
    books: [],
    publications: [],
    projects: [],
    websiteUrl: "",
    linkedInUrl: "",
    photoUrl: "",
    resumeUrl: "",
    showResume: false,
    showExperience: true,
    showEducation: true,
    showWorks: true,
    seoTitle: "",
    metaDescription: "",
    canonicalPath: "",
  };
  const slug =
    privateRow.display_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `teacher-${userId.slice(0, 8)}`;
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">وب‌سایت مجموعه</div>
          <h1 className="page-title">
            پروفایل عمومی {privateRow.display_name}
          </h1>
          <p className="page-description">
            تنها اطلاعاتی که اینجا منتشر می‌کنید در سایت عمومی دیده می‌شود.
          </p>
        </div>
      </div>
      <InstructorProfileWorkspace
        userId={userId}
        initial={{
          id: existing?.id ?? "",
          slug: existing?.slug ?? slug,
          published: existing?.published ?? false,
          content: existing?.content ?? empty,
        }}
      />
    </main>
  );
}
