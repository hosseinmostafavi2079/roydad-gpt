import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";

export function TenantAuthShell({
  brandName,
  primaryColor,
  logoUrl,
  welcomeText,
  children,
}: {
  brandName: string;
  primaryColor: string;
  logoUrl?: string | undefined;
  welcomeText?: string | undefined;
  children: ReactNode;
}) {
  return (
    <main
      className="tenant-auth-page"
      style={{ "--tenant-auth-primary": primaryColor } as CSSProperties}
    >
      <section className="tenant-auth-card">
        <div className="tenant-auth-brand">
          {logoUrl ? (
            <Image src={logoUrl} alt="" width={52} height={52} unoptimized />
          ) : (
            <span className="tenant-auth-monogram" aria-hidden="true">
              {brandName.slice(0, 1)}
            </span>
          )}
          <span>{brandName}</span>
        </div>
        <h1>ورود یا ثبت‌نام</h1>
        {welcomeText && <p className="tenant-auth-welcome">{welcomeText}</p>}
        {children}
      </section>
    </main>
  );
}
