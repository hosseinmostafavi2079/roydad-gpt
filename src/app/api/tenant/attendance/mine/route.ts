import { listOwnAttendance } from "@/modules/attendance/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    ({ tenant }, actor, requestId) =>
      listOwnAttendance({ tenant, actor, requestId }),
    "attendance.self.read",
    { feature: "attendance" },
  );
}
