import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getServerConfig } from "@/shared/config/env";
import { normalizeHostHeader } from "@/modules/tenants/host";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { PublicRunCard, PublicSiteShell } from "@/app/_components/public-site";
import { StructuredData } from "@/app/_components/structured-data";
import { getWebsiteProfile } from "@/modules/public-site/profile";
import { listPublicRuns } from "@/modules/public-site/repository";
import {
  publicCanonical,
  publicMetadata,
} from "@/modules/public-site/metadata";
import { listPublicInstructors } from "@/modules/public-site/instructors";
import { listSiteEntries } from "@/modules/public-site/content";
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
  const [instructors, faqs, testimonials, gallery] = await Promise.all([
    listPublicInstructors(tenant),
    listSiteEntries(tenant, "FAQ"),
    listSiteEntries(tenant, "TESTIMONIAL"),
    listSiteEntries(tenant, "GALLERY"),
  ]);
  const categories = [
    ...new Set(runs.map((run) => run.category).filter(Boolean)),
  ].slice(0, 8);
  const sections = {
    hero: (
      <section
        className={`public-hero public-hero-${settings.heroLayout.toLowerCase()} public-hero-${settings.heroHeight.toLowerCase()} public-overlay-${settings.heroOverlay.toLowerCase()} ${settings.heroAlignment === "CENTER" ? "public-hero-center" : ""}`}
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
          {settings.heroSecondaryText && settings.heroSecondaryHref && (
            <a className="public-text-link" href={settings.heroSecondaryHref}>
              {settings.heroSecondaryText}
            </a>
          )}
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
              <PublicRunCard
                key={run.id}
                run={run}
                preset={settings.eventCardStyle}
                showPaidPrice={tenant.features.payments}
              />
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
            <PublicRunCard
              key={run.id}
              run={run}
              preset={settings.eventCardStyle}
              showPaidPrice={tenant.features.payments}
            />
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
          {instructors.slice(0, 6).map((instructor) => (
            <article className="public-run-card" key={instructor.id}>
              {instructor.photoUrl && (
                <img
                  className="public-instructor-photo"
                  src={instructor.photoUrl}
                  alt={`تصویر ${instructor.name}`}
                  loading="lazy"
                />
              )}
              <div className="public-run-body">
                <h3>
                  <a href={`/instructors/${instructor.slug}`}>
                    {instructor.name}
                  </a>
                </h3>
                {instructor.title && <p>{instructor.title}</p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    ),
    search: (
      <section className="public-section" key="search">
        <h2>جست‌وجوی برنامه</h2>
        <form action="/events" className="public-search">
          <label htmlFor="home-event-query">نام دوره یا رویداد</label>
          <div>
            <input id="home-event-query" name="q" maxLength={80} />
            <button type="submit">جست‌وجو</button>
          </div>
        </form>
      </section>
    ),
    categories: (
      <section className="public-section" key="categories">
        <h2>موضوعات برنامه‌ها</h2>
        <div className="public-tags">
          {categories.map((category) => (
            <a
              key={category}
              href={`/events?category=${encodeURIComponent(category)}`}
            >
              {category}
            </a>
          ))}
        </div>
      </section>
    ),
    whyUs: (
      <section className="public-section" key="whyUs">
        <h2>چرا {name}؟</h2>
        <ul>
          {settings.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>
    ),
    testimonials: (
      <section className="public-section" key="testimonials">
        <h2>دیدگاه‌ها</h2>
        <div className="public-run-grid">
          {testimonials.map(
            (entry) =>
              entry.content.kind === "TESTIMONIAL" && (
                <blockquote
                  className="public-run-card public-quote"
                  key={entry.id}
                >
                  <p>{entry.content.quote}</p>
                  <footer>
                    {entry.content.name}
                    {entry.content.role && ` · ${entry.content.role}`}
                  </footer>
                </blockquote>
              ),
          )}
        </div>
      </section>
    ),
    gallery: (
      <section className="public-section" key="gallery">
        <h2>گالری</h2>
        <div className="public-gallery">
          {gallery.map(
            (entry) =>
              entry.content.kind === "GALLERY" && (
                <figure key={entry.id}>
                  <img
                    src={entry.content.imageUrl}
                    alt={entry.content.alt}
                    loading="lazy"
                  />
                  <figcaption>{entry.content.caption}</figcaption>
                </figure>
              ),
          )}
        </div>
      </section>
    ),
    faq: (
      <section className="public-section" key="faq">
        <h2>سوالات متداول</h2>
        <div className="public-faq-list">
          {faqs.slice(0, 5).map(
            (entry) =>
              entry.content.kind === "FAQ" && (
                <details key={entry.id}>
                  <summary>{entry.content.question}</summary>
                  <p>{entry.content.answer}</p>
                </details>
              ),
          )}
        </div>
        <a href="/faq">همه پرسش‌ها</a>
      </section>
    ),
    cta: (
      <section className="public-section public-final-cta" key="cta">
        <h2>{settings.heroTitle || name}</h2>
        <a className="public-button" href={settings.heroCtaHref}>
          {settings.heroCtaText}
        </a>
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
  const meaningful: Record<keyof typeof sections, boolean> = {
    hero: true,
    featured: runs.length > 0,
    upcoming: runs.length > 0,
    about: Boolean(profile.about || profile.shortDescription),
    instructors: instructors.length > 0,
    stats: settings.stats.length > 0,
    contact: Boolean(profile.phone || profile.email || profile.address),
    social: Boolean(
      profile.socialUrl || settings.whatsappUrl || settings.telegramUrl,
    ),
    newsletter: true,
    search: true,
    categories: categories.length > 0,
    whyUs: settings.features.length > 0,
    testimonials: testimonials.length > 0,
    gallery: gallery.length > 0,
    faq: faqs.length > 0,
    cta: true,
  };
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <StructuredData
        value={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name,
          url: publicCanonical(tenant, `http://${hostHeader}`, "/"),
          description: profile.shortDescription || undefined,
          ...(profile.logoUrl
            ? {
                logo: new URL(
                  profile.logoUrl,
                  publicCanonical(tenant, `http://${hostHeader}`, "/"),
                ).toString(),
              }
            : {}),
        }}
      />
      {settings.sectionOrder.map((key) =>
        settings.sections[key] && meaningful[key] ? sections[key] : null,
      )}
    </PublicSiteShell>
  );
}
