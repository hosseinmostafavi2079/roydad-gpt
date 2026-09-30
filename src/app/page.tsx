import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getServerConfig } from "@/shared/config/env";
import { normalizeHostHeader } from "@/modules/tenants/host";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { PublicRunCard, PublicSiteShell } from "@/app/_components/public-site";
import { getWebsiteProfile } from "@/modules/public-site/profile";
import { listPublicRuns } from "@/modules/public-site/repository";
import { publicMetadata } from "@/modules/public-site/metadata";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host");
  if (!host) return { title: "EventOS", robots: { index: false } };
  try {
    const tenant = await resolveTenantContext(host);
    if (!tenant.features.public_website) return { robots: { index: false } };
    const profile = await getWebsiteProfile(tenant);
    return publicMetadata(
      tenant,
      profile,
      `http://${host}`,
      "/",
      profile.displayName || tenant.branding.brandName,
    );
  } catch {
    return { title: "EventOS", robots: { index: false } };
  }
}

export default async function Home() {
  const hostHeader = (await headers()).get("host");
  if (!hostHeader) notFound();
  let hostname: string;
  try {
    hostname = normalizeHostHeader(hostHeader);
  } catch {
    notFound();
  }
  const config = getServerConfig();
  const platformHost = new URL(config.BETTER_AUTH_URL).hostname.toLowerCase();
  if (hostname === platformHost || hostname === config.PLATFORM_BASE_DOMAIN) {
    redirect("/platform");
  }
  let tenant: Awaited<ReturnType<typeof resolveTenantContext>>;
  try {
    tenant = await resolveTenantContext(hostHeader);
  } catch {
    notFound();
  }
  if (!tenant.features.public_website) notFound();
  const [profile, runs] = await Promise.all([
    getWebsiteProfile(tenant),
    listPublicRuns(tenant),
  ]);
  const name = profile.displayName || tenant.branding.brandName;
  const settings = profile.siteSettings;
  const sections = {
    hero: (
      <section
        className={`public-hero ${settings.heroAlignment === "CENTER" ? "public-hero-center" : ""}`}
        key="hero"
      >
        <div>
          <span className="public-eyebrow">
            {settings.slogan || `به ${name} خوش آمدید`}
          </span>
          <h1>{settings.heroTitle || name}</h1>
          <p>
            {settings.heroSubtitle ||
              profile.shortDescription ||
              `دوره‌ها و رویدادهای ${name} را ببینید.`}
          </p>
          <a className="public-button" href={settings.heroCtaHref}>
            {settings.heroCtaText}
          </a>
        </div>
        {profile.coverUrl && <img src={profile.coverUrl} alt="" />}
      </section>
    ),
    featured: (
      <section className="public-section" key="featured">
        <div className="public-section-heading">
          <div>
            <span className="public-eyebrow">برنامه‌های پیش رو</span>
            <h2>دوره‌ها و رویدادها</h2>
          </div>
          <a href="/events">مشاهده همه</a>
        </div>
        {runs.length ? (
          <div className="public-run-grid">
            {runs.slice(0, 6).map((run) => (
              <PublicRunCard key={run.id} run={run} />
            ))}
          </div>
        ) : (
          <p className="public-empty">هنوز برنامه منتشرشده‌ای وجود ندارد.</p>
        )}
      </section>
    ),
    upcoming: (
      <section className="public-section" key="upcoming">
        <h2>دوره‌های آینده</h2>
        <div className="public-run-grid">
          {runs.slice(0, 3).map((run) => (
            <PublicRunCard key={run.id} run={run} />
          ))}
        </div>
      </section>
    ),
    about: (
      <section className="public-about-band" key="about">
        {settings.aboutImageUrl && (
          <img
            className="public-about-image"
            src={settings.aboutImageUrl}
            alt=""
          />
        )}
        <span className="public-eyebrow">آشنایی با مجموعه</span>
        <h2>{settings.aboutTitle || `درباره ${name}`}</h2>
        <p>
          {profile.about ||
            profile.shortDescription ||
            "اطلاعات این مجموعه به‌زودی منتشر می‌شود."}
        </p>
        {settings.foundingYear && <p>سال تأسیس: {settings.foundingYear}</p>}
        {settings.features.length > 0 && (
          <ul>
            {settings.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        )}
        <a href="/about">بیشتر بخوانید ←</a>
      </section>
    ),
    instructors: (
      <section className="public-section" key="instructors">
        <h2>مدرسان</h2>
        <div className="public-run-grid">
          {[...new Set(runs.map((run) => run.instructor).filter(Boolean))]
            .slice(0, 6)
            .map((instructor) => (
              <article className="card card-pad" key={instructor}>
                {instructor}
              </article>
            ))}
        </div>
      </section>
    ),
    stats: (
      <section className="public-section" key="stats">
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
    ),
    contact: (
      <section className="public-section" key="contact">
        <div className="public-section-heading">
          <div>
            <span className="public-eyebrow">ارتباط با ما</span>
            <h2>در تماس باشید</h2>
          </div>
          <a href="/contact">{settings.contactCtaText}</a>
        </div>
        {profile.phone && <p>{profile.phone}</p>}
        {profile.contactHours && <p>{profile.contactHours}</p>}
      </section>
    ),
    social: (
      <section className="public-section" key="social">
        <h2>شبکه‌های اجتماعی</h2>
        {profile.socialUrl && <a href={profile.socialUrl}>شبکه اجتماعی</a>}
        {settings.whatsappUrl && <a href={settings.whatsappUrl}>واتساپ</a>}
        {settings.telegramUrl && <a href={settings.telegramUrl}>تلگرام</a>}
      </section>
    ),
    newsletter: (
      <section className="public-section" key="newsletter">
        <h2>با ما همراه باشید</h2>
        <p>برنامه‌های تازه را دنبال کنید.</p>
        <a href="/events">مشاهده رویدادها</a>
      </section>
    ),
  };
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      {settings.sectionOrder.map((key) =>
        settings.sections[key] ? sections[key] : null,
      )}
    </PublicSiteShell>
  );
}
