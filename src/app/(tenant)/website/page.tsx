import { WebsiteEditor } from "@/app/_components/website-editor";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { getWebsiteProfile } from "@/modules/public-site/profile";
import {
  listPublicRuns,
  listPublicCategories,
} from "@/modules/public-site/repository";
import { listPublicInstructors } from "@/modules/public-site/instructors";

export default async function WebsitePage() {
  const { tenant } = await requireTenantPage("website.manage");
  const [profile, runs, instructors, categories] = await Promise.all([
    getWebsiteProfile(tenant),
    listPublicRuns(tenant),
    listPublicInstructors(tenant),
    listPublicCategories(tenant),
  ]);
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">حضور آنلاین</div>
          <h1 className="page-title">وب‌سایت مجموعه</h1>
          <p className="page-description">
            اطلاعات عمومی و ظاهر سایت سازمان را مدیریت کنید.
          </p>
        </div>
        <a
          className="button button-secondary"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          پیش‌نمایش سایت
        </a>
      </div>
      <WebsiteEditor
        initial={profile}
        featuredOptions={{
          runs: runs.map((run) => ({ id: run.id, title: run.title })),
          instructors: instructors.map((instructor) => ({
            id: instructor.id,
            title: instructor.name,
          })),
          categories,
        }}
      />
    </main>
  );
}
