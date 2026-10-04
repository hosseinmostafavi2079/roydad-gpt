import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { WebsiteProfile } from "@/modules/public-site/profile";
import type { PublicRun } from "@/modules/public-site/repository";
import { listInformationPages } from "@/modules/public-site/content";
import { PublicNavigation } from "@/app/_components/public-navigation";

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
  const navigation = [
    ...profile.siteSettings.menuOrder
      .filter((key) => profile.siteSettings.menuEnabled[key])
      .map((key) => menu[key]),
    ...pages.slice(0, 2).map((page) => ({
      href: `/pages/${page.slug}`,
      label: page.title,
    })),
  ];
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
        <PublicNavigation items={navigation} />
        <Link className="public-account-link" href="/account">
          حساب من
        </Link>
      </header>
      <main className="public-content">{children}</main>
      <footer className="public-footer">
        <div className="public-footer-intro">
          <strong>{title}</strong>
          {(profile.footerDescription || profile.shortDescription) && (
            <p>{profile.footerDescription || profile.shortDescription}</p>
          )}
        </div>
        <nav aria-label="پیوندهای پایین صفحه">
          {navigation.slice(0, 5).map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        {(profile.phone || profile.email) && (
          <div className="public-footer-contact">
            {profile.phone && (
              <a href={`tel:${profile.phone}`}>{profile.phone}</a>
            )}
            {profile.email && (
              <a href={`mailto:${profile.email}`}>{profile.email}</a>
            )}
          </div>
        )}
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
        <span className="public-run-type">
          {run.category || (run.type === "COURSE" ? "دوره" : "رویداد")}
        </span>
        <h3>
          <Link href={`/events/${run.slug}`}>{run.title}</Link>
        </h3>
        {run.summary && <p>{run.summary}</p>}
        {run.instructor && (
          <div className="public-run-instructor">مدرس: {run.instructor}</div>
        )}
        <div className="public-run-meta">
          <span>{formatDate(run.startsAt)}</span>
          <span>
            {run.deliveryMode === "ONLINE"
              ? "آنلاین"
              : run.deliveryMode === "HYBRID"
                ? "ترکیبی"
                : "حضوری"}
          </span>
        </div>
        <div className="public-run-bottom">
          <strong>
            {run.confirmedCount >= run.capacity
              ? "ظرفیت تکمیل"
              : BigInt(run.priceAmount) === 0n
                ? "رایگان"
                : showPaidPrice
                  ? `${Number(run.priceAmount).toLocaleString("fa-IR")} ${run.priceCurrency}`
                  : "جزئیات هزینه"}
          </strong>
          <Link className="public-text-link" href={`/events/${run.slug}`}>
            مشاهده برنامه ←
          </Link>
        </div>
      </div>
    </article>
  );
}

export { formatDate };
