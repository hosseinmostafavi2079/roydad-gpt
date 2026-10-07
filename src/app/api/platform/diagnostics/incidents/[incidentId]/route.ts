import { z } from "zod";
import { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function GET(
  request: Request,
  context: { params: Promise<{ incidentId: string }> },
) {
  return withPlatformAdminRoute(request, async () =>
    new DiagnosticsRepository().getIncident(
      z.uuid().parse((await context.params).incidentId),
    ),
  );
}
