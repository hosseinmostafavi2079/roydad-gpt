import { z } from "zod";
import { getSessionAttendance } from "@/modules/attendance/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { sessionId } = await context.params;
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(new URL(request.url).searchParams.get("page") ?? "1");
      return getSessionAttendance(
        { tenant, actor, requestId },
        z.uuid().parse(sessionId),
        page,
      );
    },
    "attendance.view",
    { feature: "attendance" },
  );
}
