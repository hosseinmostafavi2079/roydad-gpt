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
    "/about",
    `درباره ${profile.displayName || tenant.branding.brandName}`,
    profile.shortDescription,
  );
}
export default async function AboutPage() {
  const { tenant, profile } = await publicPageContext();
  const settings = profile.siteSettings;
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <div className="public-about-intro">
        <div>
          <span className="public-eyebrow">آشنایی با مجموعه</span>
          <h1>درباره {profile.displayName || tenant.branding.brandName}</h1>
          {(profile.about || profile.shortDescription) && (
            <p className="public-prose">
              {profile.about || profile.shortDescription}
            </p>
          )}
          {settings.foundingYear && (
            <span className="public-about-founded">
              از سال {settings.foundingYear}
            </span>
          )}
        </div>
        {settings.aboutImageUrl && (
          <figure className="public-about-image-block">
            <img
              src={settings.aboutImageUrl}
              alt={`نمایی از ${profile.displayName}`}
              loading="lazy"
            />
          </figure>
        )}
      </div>
      {settings.aboutStory && (
        <section className="public-section">
          <h2>داستان ما</h2>
          <p>{settings.aboutStory}</p>
        </section>
      )}
      {settings.aboutMission && (
        <section className="public-section">
          <h2>مأموریت</h2>
          <p>{settings.aboutMission}</p>
        </section>
      )}
      {settings.aboutVision && (
        <section className="public-section">
          <h2>چشم‌انداز</h2>
          <p>{settings.aboutVision}</p>
        </section>
      )}
      {settings.aboutValues.length > 0 && (
        <section className="public-section">
          <h2>ارزش‌ها</h2>
          <ul>
            {settings.aboutValues.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {settings.stats.length > 0 && (
        <section className="public-section">
          <h2>مجموعه در یک نگاه</h2>
          <div className="public-stats">
            {settings.stats.map((stat) => (
              <div key={`${stat.value}-${stat.label}`}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <aside className="public-about-next">
        <div>
          <span className="public-eyebrow">گام بعدی</span>
          <h2>برنامه‌های آموزشی را ببینید</h2>
          <p>دوره‌ها و رویدادهای منتشرشدهٔ مجموعه را در یک جا پیدا کنید.</p>
        </div>
        <div className="public-about-actions">
          <a className="public-button" href="/events">
            مشاهده برنامه‌ها
          </a>
          {(profile.phone || profile.email) && (
            <a className="public-text-link" href="/contact">
              راه‌های ارتباطی ←
            </a>
          )}
        </div>
      </aside>
    </PublicSiteShell>
  );
}
