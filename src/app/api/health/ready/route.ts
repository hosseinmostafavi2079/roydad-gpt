import { getControlPool } from "@/infrastructure/db/control/pool";
import { logger } from "@/infrastructure/logging/logger";
import { jsonResponse } from "@/shared/http/api-response";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    await getControlPool().query("SELECT 1");
    return jsonResponse({ data: { status: "ready" } });
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.name : "unknown",
        eventCode: "CONTROL_DB_UNAVAILABLE",
      },
      "Readiness check failed",
    );
    return jsonResponse({ data: { status: "unavailable" } }, { status: 503 });
  }
}
