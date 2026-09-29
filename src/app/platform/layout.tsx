import Link from "next/link";
import { requirePlatformPageAdmin } from "@/infrastructure/auth/platform-session";
import { PlatformNav } from "@/app/_components/platform-nav";
import { SignOutButton } from "@/app/_components/sign-out-button";

export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requirePlatformPageAdmin();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/platform" className="brand" aria-label="صفحهٔ اصلی EventOS">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span className="brand-name">
            EventOS<span className="brand-caption">پلتفرم رویدادها</span>
          </span>
        </Link>
        <div>
          <p className="nav-group-title">مدیریت پلتفرم</p>
          <PlatformNav />
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
          <SignOutButton />
        </div>
      </aside>
      <div className="main">
        <div className="mobile-top">
          <Link href="/platform" className="brand">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span className="brand-name">EventOS</span>
          </Link>
          <span className="admin-name">{actor.name}</span>
        </div>
        <PlatformNav />
        <header className="topbar">
          <div className="crumbs">
            پلتفرم <span aria-hidden="true">/</span> فضای مدیریت
          </div>
          <div className="topbar-side">
            <span>
              <span className="status-dot" aria-hidden="true" />
              مدیریت امن
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
