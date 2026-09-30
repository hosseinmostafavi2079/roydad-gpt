import { checkInWithQr } from "@/modules/attendance/repository";
import { attendanceCheckInInput } from "@/modules/attendance/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      checkInWithQr(
        { tenant, actor, requestId },
        (await parseJson(request, attendanceCheckInInput)).token,
      ),
    "attendance.checkin",
    { mutation: true, feature: "qr_attendance" },
  );
}
