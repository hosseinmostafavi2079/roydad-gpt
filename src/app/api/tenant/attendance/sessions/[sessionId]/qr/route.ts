import { z } from "zod";
import { issueAttendanceQr } from "@/modules/attendance/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { sessionId } = await context.params;
      return issueAttendanceQr(
        { tenant, actor, requestId },
        z.uuid().parse(sessionId),
      );
    },
    "attendance.manage",
    { mutation: true, feature: "qr_attendance" },
  );
}
