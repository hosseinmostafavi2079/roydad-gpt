"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TenantNavItem = { href: string; title: string; group: string };

const groupIcons: Record<string, string> = {
  داشبورد: "⌂",
  رویدادها: "▣",
  افراد: "♙",
  عملیات: "◈",
  وب‌سایت: "◎",
  مدیریت: "⚙",
};

export function TenantNav({ items }: { items: TenantNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="nav-list" aria-label="پیمایش سازمان">
      {items.some((item) => item.group === "داشبورد") && (
        <Link
          className={`nav-link${pathname === "/dashboard" ? " active" : ""}`}
          href="/dashboard"
        >
          <span className="nav-icon" aria-hidden="true">
            ⌂
          </span>
          داشبورد
        </Link>
      )}
      {["رویدادها", "افراد", "عملیات", "وب‌سایت", "مدیریت"].map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (!groupItems.length) return null;
        return (
          <details
            className="nav-group"
            key={group}
            open={groupItems.some(
              (item) =>
                pathname === item.href || pathname.startsWith(`${item.href}/`),
            )}
          >
            <summary className="nav-group-trigger">
              <span className="nav-icon" aria-hidden="true">
                {groupIcons[group]}
              </span>
              {group}
            </summary>
            <div className="nav-group-links">
              {groupItems.map((item) => (
                <Link
                  key={item.href}
                  className={`nav-link${pathname === item.href || pathname.startsWith(`${item.href}/`) ? " active" : ""}`}
                  aria-current={pathname === item.href ? "page" : undefined}
                  href={item.href}
                >
                  {item.title}
                </Link>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
