"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TenantNavItem = { href: string; title: string };

export function TenantNav({ items }: { items: TenantNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="nav-list" aria-label="پیمایش سازمان">
      {items.map((item) => (
        <Link
          className={`nav-link${pathname === item.href || pathname.startsWith(`${item.href}/`) ? " active" : ""}`}
          aria-current={pathname === item.href ? "page" : undefined}
          href={item.href}
          key={item.href}
        >
          <span className="nav-icon" aria-hidden="true">
            ◇
          </span>
          <span>{item.title}</span>
        </Link>
      ))}
    </nav>
  );
}
