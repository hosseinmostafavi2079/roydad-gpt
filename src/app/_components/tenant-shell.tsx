import Link from "next/link";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { TenantSignOutButton } from "@/app/_components/tenant-sign-out-button";

const navItems = [
  { href: "/dashboard", title: "نمای کلی", permission: "dashboard.read" },
  { href: "/staff", title: "کارکنان", permission: "staff.read" },
  {
    href: "/instructors",
    title: "مربیان",
    permission: "instructor.read",
    feature: "crm" as const,
  },
  {
    href: "/participants",
    title: "شرکت‌کنندگان",
    permission: "participant.read",
    feature: "crm" as const,
  },
  { href: "/roles", title: "نقش‌ها و دسترسی‌ها", permission: "role.read" },
  { href: "/audit", title: "گزارش امنیتی", permission: "audit.read" },
  { href: "/settings", title: "تنظیمات سازمان", permission: "settings.read" },
];

function Navigation({
  actor,
  tenant,
  mobile = false,
}: {
  actor: TenantActor;
  tenant: TenantContext;
  mobile?: boolean;
}) {
  const links = navItems.filter(
    (item) =>
      actor.permissions.has(item.permission) &&
      (!item.feature || tenant.features[item.feature]),
  );
  return (
    <nav
      className={`nav-list ${mobile ? "mobile-nav" : "desktop-nav"}`}
      aria-label="پیمایش سازمان"
    >
      {links.map((item) => (
        <Link className="nav-link" href={item.href} key={item.href}>
          <span className="nav-icon" aria-hidden="true">
            ◇
          </span>
          {item.title}
        </Link>
      ))}
    </nav>
  );
}

export function TenantShell({
  children,
  actor,
  tenant,
}: {
  children: React.ReactNode;
  actor: TenantActor;
  tenant: TenantContext;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link
          href="/dashboard"
          className="brand"
          aria-label={tenant.branding.brandName}
        >
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span className="brand-name">
            {tenant.branding.brandName}
            <span className="brand-caption">مدیریت سازمان</span>
          </span>
        </Link>
        <div>
          <p className="nav-group-title">فضای سازمان</p>
          <Navigation actor={actor} tenant={tenant} />
        </div>
        <div className="sidebar-bottom">
          <div className="admin-chip">
            <span className="avatar" aria-hidden="true">
              {actor.name.slice(0, 1)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="admin-name">{actor.name}</div>
              <div className="admin-email">{actor.email}</div>
            </div>
          </div>
          <TenantSignOutButton />
        </div>
      </aside>
      <div className="main">
        <div className="mobile-top">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span className="brand-name">{tenant.branding.brandName}</span>
          </Link>
          <span className="admin-name">{actor.name}</span>
        </div>
        <Navigation actor={actor} tenant={tenant} mobile />
        <header className="topbar">
          <div className="crumbs">
            {tenant.branding.brandName} <span aria-hidden="true">/</span> پنل
            سازمان
          </div>
          <div className="topbar-side">
            <span>
              <span className="status-dot" aria-hidden="true" />
              سازمان فعال
            </span>
            <span
              className="avatar"
              aria-hidden="true"
              style={{ width: 30, height: 30, flexBasis: 30 }}
            >
              {actor.name.slice(0, 1)}
            </span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
