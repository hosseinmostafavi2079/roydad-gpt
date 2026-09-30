import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicSiteShell } from "@/app/_components/public-site";
import { verifyCertificate } from "@/modules/certificates/repository";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { getWebsiteProfile } from "@/modules/public-site/profile";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "اعتبارسنجی گواهی",
  robots: { index: false, follow: false },
};
export default async function CertificateVerificationPage({
  params,
}: {
  params: Promise<{ verificationCode: string }>;
}) {
  const { tenant } = await resolveTenantFromHeaders(await headers());
  const profile = await getWebsiteProfile(tenant);
  const { verificationCode } = await params;
  const record = await verifyCertificate(tenant, verificationCode);
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <section className="public-page-header">
        <span className="public-eyebrow">اعتبارسنجی گواهی</span>
        <h1>{record ? "گواهی معتبر است" : "گواهی معتبر یافت نشد"}</h1>
        {record ? (
          <p>
            این گواهی برای {record.participantName} در برنامه{" "}
            {record.programName} صادر شده است.
          </p>
        ) : (
          <p>کد نامعتبر است یا گواهی لغو شده است.</p>
        )}
      </section>
      {record ? (
        <section className="public-section">
          <p>صادرکننده: {tenant.branding.brandName}</p>
          <p>شماره: {record.serialNumber}</p>
          <p>تاریخ صدور: {record.issuedAt.toLocaleDateString("fa-IR")}</p>
        </section>
      ) : null}
    </PublicSiteShell>
  );
}
