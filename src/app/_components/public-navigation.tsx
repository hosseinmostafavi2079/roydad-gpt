"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = Readonly<{ href: string; label: string }>;

export function PublicNavigation({ items }: { items: readonly Item[] }) {
  const pathname = usePathname();
  const links = items.map((item) => (
    <Link
      href={item.href}
      key={item.href}
      aria-current={
        pathname === item.href ||
        (item.href !== "/" && pathname.startsWith(`${item.href}/`))
          ? "page"
          : undefined
      }
    >
      {item.label}
    </Link>
  ));
  return (
    <>
      <nav className="public-desktop-nav" aria-label="ناوبری سایت">
        {links}
      </nav>
      <details className="public-mobile-menu">
        <summary aria-label="باز کردن منوی سایت">
          منو <span aria-hidden="true">☰</span>
        </summary>
        <nav aria-label="ناوبری موبایل">
          {links}
          <Link href="/account">حساب من</Link>
        </nav>
      </details>
    </>
  );
}
