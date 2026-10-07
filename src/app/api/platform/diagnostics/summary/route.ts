import { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function GET(request: Request) {
  return withPlatformAdminRoute(request, () =>
    new DiagnosticsRepository().getDiagnosticsSummary(),
  );
}
