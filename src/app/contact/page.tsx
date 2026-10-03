import { PublicSiteShell } from "@/app/_components/public-site";
import { publicPageContext } from "@/modules/public-site/page-context";
import { publicMetadata } from "@/modules/public-site/metadata";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { tenant, profile, origin } = await publicPageContext();
  return publicMetadata(
    tenant,
    profile,
    origin,
    "/contact",
    `تماس با ${profile.displayName || tenant.branding.brandName}`,
  );
}
export default async function ContactPage() {
  const { tenant, profile } = await publicPageContext();
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">راه‌های ارتباطی</span>
        <h1>تماس با ما</h1>
      </section>
      <div className="public-contact-grid">
        {profile.phone && (
          <div>
            <h2>تلفن</h2>
            <a href={`tel:${profile.phone}`}>{profile.phone}</a>
          </div>
        )}
        {profile.email && (
          <div>
            <h2>ایمیل</h2>
            <a href={`mailto:${profile.email}`}>{profile.email}</a>
          </div>
        )}
        {profile.address && (
          <div>
            <h2>نشانی</h2>
            <p>{profile.address}</p>
          </div>
        )}
        {profile.contactHours && (
          <div>
            <h2>ساعت پاسخ‌گویی</h2>
            <p>{profile.contactHours}</p>
          </div>
        )}
        {profile.siteSettings.contactMapUrl && (
          <div>
            <h2>موقعیت</h2>
            <a
              href={profile.siteSettings.contactMapUrl}
              rel="noopener noreferrer"
            >
              مشاهده نقشه
            </a>
          </div>
        )}
        {profile.siteSettings.telegramUrl && (
          <div>
            <h2>تلگرام</h2>
            <a
              href={profile.siteSettings.telegramUrl}
              rel="noopener noreferrer"
            >
              ارتباط در تلگرام
            </a>
          </div>
        )}
        {profile.siteSettings.whatsappUrl && (
          <div>
            <h2>واتساپ</h2>
            <a
              href={profile.siteSettings.whatsappUrl}
              rel="noopener noreferrer"
            >
              ارتباط در واتساپ
            </a>
          </div>
        )}
        {profile.socialUrl && (
          <div>
            <h2>شبکه اجتماعی</h2>
            <a href={profile.socialUrl} rel="noopener noreferrer">
              مشاهده صفحه
            </a>
          </div>
        )}
        {profile.siteSettings.contactCtaHref && (
          <div>
            <a
              className="public-button"
              href={profile.siteSettings.contactCtaHref}
            >
              {profile.siteSettings.contactCtaText}
            </a>
          </div>
        )}
        {!profile.phone && !profile.email && !profile.address && (
          <p className="public-empty">اطلاعات تماس هنوز منتشر نشده است.</p>
        )}
      </div>
    </PublicSiteShell>
  );
}
