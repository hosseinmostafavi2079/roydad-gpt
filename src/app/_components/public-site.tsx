import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { WebsiteProfile } from "@/modules/public-site/profile";
import type { PublicRun } from "@/modules/public-site/repository";
import { listInformationPages } from "@/modules/public-site/content";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "long",
    timeZone: "Asia/Tehran",
  }).format(date);
}

export async function PublicSiteShell({
  tenant,
  profile,
  children,
}: {
  tenant: TenantContext;
  profile: WebsiteProfile;
  children: ReactNode;
}) {
  const title = profile.displayName || tenant.branding.brandName;
  const pages = await listInformationPages(tenant);
  const menu = {
    home: { href: "/", label: "خانه" },
    events: { href: "/events", label: "دوره‌ها و رویدادها" },
    instructors: { href: "/instructors", label: "مدرس‌ها" },
    about: { href: "/about", label: "درباره ما" },
    contact: { href: "/contact", label: "تماس با ما" },
    faq: { href: "/faq", label: "سوالات متداول" },
  };
  const style = {
    "--public-primary": profile.primaryColor,
    "--public-secondary": profile.secondaryColor,
    "--public-accent": profile.accentColor,
    "--public-background": profile.siteSettings.backgroundColor,
    "--public-surface": profile.siteSettings.surfaceColor,
    "--public-text": profile.siteSettings.textColor,
    "--public-radius":
      profile.radiusStyle === "LARGE"
        ? "24px"
        : profile.radiusStyle === "SMALL"
          ? "8px"
          : "16px",
  } as CSSProperties;
  return (
    <div
      className={`public-site public-template-${profile.siteSettings.template.toLowerCase()} public-width-${profile.siteSettings.contentWidth.toLowerCase()} public-spacing-${profile.siteSettings.spacing.toLowerCase()} ${profile.siteSettings.fontPreset === "TAHOMA" ? "public-font-tahoma" : ""} ${profile.siteSettings.buttonStyle === "OUTLINE" ? "public-buttons-outline" : ""}`}
      dir="rtl"
      style={style}
    >
      <header className="public-header">
        <Link href="/" className="public-logo">
          {profile.logoUrl ? (
            <img src={profile.logoUrl} alt="" width="42" height="42" />
          ) : (
            <span aria-hidden="true">{title.slice(0, 1)}</span>
          )}
          <strong>{title}</strong>
        </Link>
        <nav aria-label="ناوبری سایت">
          {profile.siteSettings.menuOrder
            .filter((key) => profile.siteSettings.menuEnabled[key])
            .map((key) => (
              <Link href={menu[key].href} key={key}>
                {menu[key].label}
              </Link>
            ))}
          {pages.slice(0, 6).map((page) => (
            <Link href={`/pages/${page.slug}`} key={page.id}>
              {page.title}
            </Link>
          ))}
        </nav>
        <Link className="public-account-link" href="/account">
          حساب من
        </Link>
      </header>
      <main className="public-content">{children}</main>
      <footer className="public-footer">
        <strong>{title}</strong>
        <span>{profile.footerDescription || profile.shortDescription}</span>
        <nav aria-label="پیوندهای پایین صفحه">
          <Link href="/about">درباره ما</Link>
          <Link href="/contact">تماس با ما</Link>
        </nav>
      </footer>
    </div>
  );
}

export function PublicRunCard({
  run,
  preset = "VISUAL",
  showPaidPrice = false,
}: {
  run: PublicRun;
  preset?: "COMPACT" | "VISUAL" | "DETAILED";
  showPaidPrice?: boolean;
}) {
  return (
    <article
      className={`public-run-card public-run-card-${preset.toLowerCase()}`}
    >
      <div className="public-run-art" aria-hidden="true">
        {run.coverUrl ? (
          <img src={run.coverUrl} alt="" loading="lazy" />
        ) : run.type === "COURSE" ? (
          "دوره"
        ) : (
          "رویداد"
        )}
      </div>
      <div className="public-run-body">
        <span className="public-eyebrow">{formatDate(run.startsAt)}</span>
        <h3>
          <Link href={`/events/${run.slug}`}>{run.title}</Link>
        </h3>
        <p>
          {run.summary ||
            "اطلاعات این برنامه را ببینید و برای حضور برنامه‌ریزی کنید."}
        </p>
        <div className="public-run-meta">
          <span>
            {run.deliveryMode === "ONLINE"
              ? "آنلاین"
              : run.deliveryMode === "HYBRID"
                ? "ترکیبی"
                : "حضوری"}
          </span>
          {run.instructor && <span>{run.instructor}</span>}
          {run.category && <span>{run.category}</span>}
          {run.confirmedCount >= run.capacity && <span>ظرفیت تکمیل</span>}
          {run.confirmedCount < run.capacity &&
            BigInt(run.priceAmount) === 0n && <span>رایگان</span>}
          {run.confirmedCount < run.capacity &&
            BigInt(run.priceAmount) > 0n &&
            showPaidPrice && (
              <span>
                {Number(run.priceAmount).toLocaleString("fa-IR")}{" "}
                {run.priceCurrency}
              </span>
            )}
        </div>
        <Link className="public-text-link" href={`/events/${run.slug}`}>
          مشاهده جزئیات ←
        </Link>
      </div>
    </article>
  );
}

export { formatDate };
