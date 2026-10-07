import { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";
import { incidentListSchema } from "@/modules/platform/diagnostics/schema";
import {
  parseQuery,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function GET(request: Request) {
  return withPlatformAdminRoute(request, () =>
    new DiagnosticsRepository().listIncidents(
      parseQuery(request, incidentListSchema),
    ),
  );
}
