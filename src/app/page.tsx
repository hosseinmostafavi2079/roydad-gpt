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
import { PublicEventArtwork } from "@/app/_components/public-event-artwork";
import { PublicPortrait } from "@/app/_components/public-portrait";
import type { Metadata } from "next";

function CategoryGlyph({
  kind,
}: {
  kind: "NONE" | "BOOK" | "SCREEN" | "PEOPLE";
}) {
  if (kind === "NONE") return null;
  const path =
    kind === "BOOK" ? (
      <>
        <path d="M12 5c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" />
        <path d="M12 5v13" />
      </>
    ) : kind === "SCREEN" ? (
      <>
        <rect x="3" y="4" width="18" height="13" rx="1" />
        <path d="M8 21h8M12 17v4" />
      </>
    ) : (
      <>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="8" r="3" />
        <path d="M2 20c0-4 2-6 6-6s6 2 6 6M12 16c1-1 3-2 5-2 4 0 5 2 5 6" />
      </>
    );
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      width="28"
      height="28"
    >
      {path}
    </svg>
  );
}

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
  ]
    .sort(
      (a, b) =>
        Number(settings.featuredCategories.includes(b)) -
          Number(settings.featuredCategories.includes(a)) ||
        (settings.categoryPresentation[a]?.order ?? 50) -
          (settings.categoryPresentation[b]?.order ?? 50),
    )
    .slice(0, 8);
  const featuredRuns = [...runs].sort(
    (a, b) =>
      Number(settings.featuredRunIds.includes(b.id)) -
      Number(settings.featuredRunIds.includes(a.id)),
  );
  const featuredInstructors = [...instructors].sort(
    (a, b) =>
      Number(settings.featuredInstructorIds.includes(b.id)) -
      Number(settings.featuredInstructorIds.includes(a.id)),
  );
  const heroRun = featuredRuns[0];
  const sections = {
    hero: (
      <section
        className={`public-hero public-hero-${settings.heroLayout.toLowerCase()} public-hero-${settings.heroHeight.toLowerCase()} public-overlay-${settings.heroOverlay.toLowerCase()} ${settings.heroAlignment === "CENTER" ? "public-hero-center" : ""}`}
        key="hero"
      >
        <div className="public-hero-copy">
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
          <search>
            <form action="/events" className="public-hero-search">
              <label htmlFor="home-hero-search">
                چه چیزی می‌خواهید یاد بگیرید؟
              </label>
              <div>
                <input
                  id="home-hero-search"
                  name="q"
                  maxLength={80}
                  placeholder="نام دوره یا رویداد"
                />
                <button type="submit">جست‌وجو</button>
              </div>
            </form>
          </search>
          {categories.length > 0 && (
            <nav
              className="public-hero-categories"
              aria-label="موضوعات پرکاربرد"
            >
              {categories.slice(0, 3).map((category) => (
                <a
                  key={category}
                  href={`/events?category=${encodeURIComponent(category)}`}
                >
                  {category}
                </a>
              ))}
            </nav>
          )}
        </div>
        {profile.coverUrl ? (
          <div className="public-hero-media">
            <img src={profile.coverUrl} alt="" />
          </div>
        ) : heroRun ? (
          <a className="public-hero-feature" href={`/events/${heroRun.slug}`}>
            <PublicEventArtwork
              src={heroRun.coverUrl}
              title={heroRun.title}
              category={heroRun.category}
              type={heroRun.type}
              eager
            />
            <span className="public-hero-feature-caption">
              <small>
                برنامه پیش رو ·{" "}
                {heroRun.category ||
                  (heroRun.type === "COURSE" ? "دوره" : "رویداد")}
              </small>
              <strong>{heroRun.title}</strong>
              <span>مشاهده برنامه ←</span>
            </span>
          </a>
        ) : (
          <div className="public-hero-brand-panel" aria-hidden="true">
            <span>{name}</span>
            <i />
          </div>
        )}
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
          <div
            className={`public-run-grid public-run-grid-count-${Math.min(runs.length, 3)}`}
          >
            {featuredRuns.slice(0, 4).map((run, index) => (
              <PublicRunCard
                key={run.id}
                run={run}
                preset={settings.eventCardStyle}
                showPaidPrice={tenant.features.payments}
                variant={
                  index === 0 && runs.length > 2 ? "featured" : "standard"
                }
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
          {featuredRuns.slice(4, 7).map((run) => (
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
        <p>{profile.about || profile.shortDescription}</p>
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
          {featuredInstructors.slice(0, 6).map((instructor) => (
            <article className="public-run-card" key={instructor.id}>
              <PublicPortrait
                src={instructor.photoUrl}
                name={instructor.name}
              />
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
        <div className="public-category-grid">
          {categories.map((category) => {
            const presentation = settings.categoryPresentation[category];
            return (
              <a
                className="public-category-card"
                key={category}
                href={`/events?category=${encodeURIComponent(category)}`}
              >
                {presentation?.imageUrl ? (
                  <PublicEventArtwork
                    src={presentation.imageUrl}
                    title={category}
                    category="موضوع"
                    type="COURSE"
                  />
                ) : (
                  <CategoryGlyph kind={presentation?.icon ?? "NONE"} />
                )}
                <strong>{category}</strong>
                {presentation?.description && (
                  <span>{presentation.description}</span>
                )}
                <small>مشاهده برنامه‌ها ←</small>
              </a>
            );
          })}
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
    upcoming: runs.length > 4,
    about: Boolean(profile.about || profile.shortDescription),
    instructors: instructors.length > 0,
    stats: settings.stats.length > 0,
    contact: Boolean(profile.phone || profile.email || profile.address),
    social: Boolean(
      profile.socialUrl || settings.whatsappUrl || settings.telegramUrl,
    ),
    newsletter: Boolean(profile.email),
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
      {settings.sectionOrder.map((key) => {
        if (!settings.sections[key] || !meaningful[key]) return null;
        const design = settings.sectionDesigns[key];
        return (
          <div
            key={key}
            className={`public-home-block public-home-block-${key}`}
            data-background={design?.background ?? "DEFAULT"}
            data-layout={design?.layout ?? "DEFAULT"}
            data-spacing={design?.spacing ?? "NORMAL"}
            data-width={design?.width ?? "CONTAINED"}
            data-decoration={design?.decoration ?? "NONE"}
          >
            {sections[key]}
          </div>
        );
      })}
    </PublicSiteShell>
  );
}
