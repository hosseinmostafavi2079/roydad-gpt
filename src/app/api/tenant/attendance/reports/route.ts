import { z } from "zod";
import { listParticipantAttendanceReports } from "@/modules/attendance/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    ({ tenant }, actor, requestId) => {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(new URL(request.url).searchParams.get("page") ?? "1");
      return listParticipantAttendanceReports(
        { tenant, actor, requestId },
        page,
      );
    },
    "attendance.view",
    { feature: "attendance" },
  );
}
