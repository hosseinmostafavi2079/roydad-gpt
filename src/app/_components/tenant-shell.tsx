import Link from "next/link";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { TenantSignOutButton } from "@/app/_components/tenant-sign-out-button";
import { MobileDrawer } from "@/app/_components/mobile-drawer";
import { TenantNav } from "@/app/_components/tenant-nav";

const navItems = [
  {
    href: "/dashboard",
    title: "داشبورد",
    permission: "dashboard.read",
    group: "داشبورد",
  },
  {
    href: "/programs",
    title: "دوره‌ها و رویدادها",
    permission: "program.read",
    feature: "courses" as const,
    group: "رویدادها",
  },
  {
    href: "/runs",
    title: "اجراها",
    permission: "program.read",
    feature: "courses" as const,
    group: "رویدادها",
  },
  {
    href: "/sessions",
    title: "جلسات",
    permission: "session.read",
    feature: "courses" as const,
    group: "رویدادها",
  },
  {
    href: "/calendar",
    title: "تقویم",
    permission: "session.read",
    feature: "courses" as const,
    group: "رویدادها",
  },
  {
    href: "/attendance",
    title: "حضور و غیاب",
    permission: "attendance.view",
    feature: "attendance" as const,
    group: "عملیات",
  },
  {
    href: "/certificates",
    title: "گواهی‌ها",
    permission: "certificate.read",
    feature: "certificates" as const,
    group: "عملیات",
  },
  {
    href: "/staff",
    title: "کارکنان",
    permission: "staff.read",
    group: "افراد",
  },
  {
    href: "/instructors",
    title: "مدرسان",
    permission: "instructor.read",
    feature: "crm" as const,
    group: "افراد",
  },
  {
    href: "/participants",
    title: "شرکت‌کنندگان",
    permission: "participant.read",
    feature: "crm" as const,
    group: "افراد",
  },
  {
    href: "/roles",
    title: "نقش‌ها و دسترسی‌ها",
    permission: "role.read",
    group: "مدیریت",
  },
  {
    href: "/venues",
    title: "محل برگزاری",
    permission: "settings.read",
    group: "رویدادها",
  },
  {
    href: "/audit",
    title: "گزارش فعالیت",
    permission: "audit.read",
    group: "مدیریت",
  },
  {
    href: "/settings",
    title: "تنظیمات مجموعه",
    permission: "settings.read",
    group: "مدیریت",
  },
  {
    href: "/website",
    title: "وب‌سایت مجموعه",
    permission: "website.manage",
    group: "وب‌سایت",
  },
  {
    href: "/enrollments",
    title: "ثبت‌نام‌ها",
    permission: "enrollment.read",
    feature: "registration" as const,
    group: "افراد",
  },
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
    .map(({ href, title, group }) => ({ href, title, group }));
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
