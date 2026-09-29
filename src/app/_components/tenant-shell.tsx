import Link from "next/link";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { TenantSignOutButton } from "@/app/_components/tenant-sign-out-button";
import { MobileDrawer } from "@/app/_components/mobile-drawer";
import { TenantNav } from "@/app/_components/tenant-nav";

const navItems = [
  { href: "/dashboard", title: "داشبورد", permission: "dashboard.read" },
  {
    href: "/programs",
    title: "دوره‌ها و رویدادها",
    permission: "program.read",
    feature: "courses" as const,
  },
  {
    href: "/runs",
    title: "اجراها",
    permission: "program.read",
    feature: "courses" as const,
  },
  {
    href: "/sessions",
    title: "جلسات",
    permission: "session.read",
    feature: "courses" as const,
  },
  {
    href: "/calendar",
    title: "تقویم",
    permission: "session.read",
    feature: "courses" as const,
  },
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
  { href: "/venues", title: "مکان‌ها", permission: "settings.read" },
  { href: "/audit", title: "گزارش امنیتی", permission: "audit.read" },
  { href: "/settings", title: "تنظیمات سازمان", permission: "settings.read" },
];

export function TenantShell({
  children,
  actor,
  tenant,
}: {
  children: React.ReactNode;
  actor: TenantActor;
  tenant: TenantContext;
}) {
  const links = navItems
    .filter(
      (item) =>
        actor.permissions.has(item.permission) &&
        (!item.feature || tenant.features[item.feature]),
    )
    .map(({ href, title }) => ({ href, title }));
  const account = (
    <>
      <div className="admin-chip">
        <span className="avatar" aria-hidden="true">
          {actor.name.slice(0, 1)}
        </span>
        <div className="account-text">
          <div className="admin-name">{actor.name}</div>
          <div className="admin-email">{actor.email}</div>
        </div>
      </div>
      <TenantSignOutButton />
    </>
  );
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
          <TenantNav items={links} />
        </div>
        <div className="sidebar-bottom">{account}</div>
      </aside>
      <div className="main">
        <div className="mobile-top">
          <MobileDrawer
            brand={tenant.branding.brandName}
            navigation={<TenantNav items={links} />}
            account={account}
          />
          <Link href="/dashboard" className="brand">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span className="brand-name">{tenant.branding.brandName}</span>
          </Link>
          <span className="mobile-page-label">پنل سازمان</span>
        </div>
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
