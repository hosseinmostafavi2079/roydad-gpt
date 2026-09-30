import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { PublicSiteShell } from "@/app/_components/public-site";
import { QrCheckIn } from "@/app/_components/qr-check-in";
import { requireTenantActor } from "@/modules/tenant-identity/request-auth";
import { publicPageContext } from "@/modules/public-site/page-context";
import { DomainError } from "@/shared/errors/domain-error";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ثبت حضور",
  robots: { index: false, follow: false },
};
export default async function CheckInPage() {
  const { tenant, profile, origin } = await publicPageContext();
  if (!tenant.features.attendance || !tenant.features.qr_attendance) notFound();
  let actor: Awaited<ReturnType<typeof requireTenantActor>>;
  try {
    actor = await requireTenantActor(tenant, origin, await headers());
  } catch (error) {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED")
      redirect("/login?participant=1");
    throw error;
  }
  if (!actor.permissions.has("attendance.checkin")) notFound();
  return (
    <PublicSiteShell tenant={tenant} profile={profile}>
      <QrCheckIn />
    </PublicSiteShell>
  );
}
