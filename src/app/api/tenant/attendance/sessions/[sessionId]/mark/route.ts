import { z } from "zod";
import { markAttendanceBatch } from "@/modules/attendance/repository";
import { attendanceMarkInput } from "@/modules/attendance/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { sessionId } = await context.params;
      return markAttendanceBatch(
        { tenant, actor, requestId },
        z.uuid().parse(sessionId),
        await parseJson(request, attendanceMarkInput),
      );
    },
    "attendance.manage",
    { mutation: true, feature: "attendance" },
  );
}
