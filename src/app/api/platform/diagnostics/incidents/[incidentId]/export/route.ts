import { z } from "zod";
import { requirePlatformAdmin } from "@/infrastructure/auth/platform-session";
import { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";
import {
  errorResponse,
  jsonResponse,
  requestIdFrom,
} from "@/shared/http/api-response";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ incidentId: string }> },
) {
  const requestId = requestIdFrom(request);
  try {
    await requirePlatformAdmin({ requestHeaders: request.headers });
    const result = await new DiagnosticsRepository().exportIncident(
      z.uuid().parse((await context.params).incidentId),
    );
    const ref = z
      .string()
      .regex(/^INC-[0-9]{8}-[A-F0-9]{32}$/)
      .parse(result.incident.incidentRef);
    return jsonResponse(
      { data: result },
      {
        headers: {
          "x-request-id": requestId,
          "content-disposition": `attachment; filename="eventos-incident-${ref}.json"`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
