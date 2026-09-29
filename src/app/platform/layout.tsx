import Link from "next/link";
import { requirePlatformPageAdmin } from "@/infrastructure/auth/platform-session";
import { PlatformNav } from "@/app/_components/platform-nav";
import { SignOutButton } from "@/app/_components/sign-out-button";
import { MobileDrawer } from "@/app/_components/mobile-drawer";

export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requirePlatformPageAdmin();
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
      <SignOutButton />
    </>
  );
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
        <div className="sidebar-bottom">{account}</div>
      </aside>
      <div className="main">
        <div className="mobile-top">
          <MobileDrawer
            brand="EventOS"
            navigation={<PlatformNav />}
            account={account}
          />
          <Link href="/platform" className="brand">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span className="brand-name">EventOS</span>
          </Link>
          <span className="mobile-page-label">مدیریت پلتفرم</span>
        </div>
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
