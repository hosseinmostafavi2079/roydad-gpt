import { z } from "zod";
import { exportSessionAttendance } from "@/modules/attendance/repository";
import { authorize } from "@/modules/tenant-identity/permissions";
import {
  requireTenantActor,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import { errorResponse, requestIdFrom } from "@/shared/http/api-response";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const actor = await requireTenantActor(tenant, origin, request.headers);
    if (!tenant.features.attendance)
      throw new DomainError("FEATURE_DISABLED", "حضور و غیاب فعال نیست.");
    authorize(actor.permissions, "attendance.export");
    const { sessionId } = await context.params;
    const csv = await exportSessionAttendance(
      { tenant, actor, requestId },
      z.uuid().parse(sessionId),
    );
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="attendance-${sessionId}.csv"`,
        "cache-control": "private, no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
