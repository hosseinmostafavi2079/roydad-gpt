"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/platform", label: "نمای کلی", icon: "⌂" },
  { href: "/platform/tenants", label: "سازمان‌ها", icon: "▦" },
  { href: "/platform/plans", label: "طرح‌ها و محدودیت‌ها", icon: "◇" },
];

export function PlatformNav({ requireMfa = false }: { requireMfa?: boolean }) {
  const pathname = usePathname();
  const visibleItems = requireMfa
    ? [
        ...items,
        { href: "/platform/security/mfa", label: "امنیت حساب", icon: "⌑" },
      ]
    : items;
  const links = visibleItems.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className={`nav-link${pathname === item.href || (item.href !== "/platform" && pathname.startsWith(`${item.href}/`)) ? " active" : ""}`}
    >
      <span aria-hidden="true" className="nav-icon">
        {item.icon}
      </span>
      {item.label}
    </Link>
  ));
  return (
    <nav className="nav-list" aria-label="منوی اصلی">
      {links}
    </nav>
  );
}
