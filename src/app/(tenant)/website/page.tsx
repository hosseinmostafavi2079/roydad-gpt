import { WebsiteEditor } from "@/app/_components/website-editor";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { getWebsiteProfile } from "@/modules/public-site/profile";

export default async function WebsitePage() {
  const { tenant } = await requireTenantPage("website.manage");
  const profile = await getWebsiteProfile(tenant);
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
      <WebsiteEditor initial={profile} />
    </main>
  );
}
