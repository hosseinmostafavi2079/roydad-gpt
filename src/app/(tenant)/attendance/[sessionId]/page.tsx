import { z } from "zod";
import { AttendanceSessionManager } from "@/app/_components/attendance-session-manager";
import { getSessionAttendance } from "@/modules/attendance/repository";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function AttendanceSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { tenant, actor } = await requireTenantPage("attendance.view");
  const { sessionId } = await params;
  const data = await getSessionAttendance(
    { tenant, actor, requestId: "attendance-session-page" },
    z.uuid().parse(sessionId),
  );
  return (
    <AttendanceSessionManager
      initial={data}
      canManage={actor.permissions.has("attendance.manage")}
      canExport={actor.permissions.has("attendance.export")}
      canQr={
        tenant.features.qr_attendance &&
        actor.permissions.has("attendance.manage")
      }
    />
  );
}
