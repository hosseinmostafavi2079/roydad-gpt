import { getControlPool } from "@/infrastructure/db/control/pool";
import { jsonResponse } from "@/shared/http/api-response";
import { logger } from "@/infrastructure/logging/logger";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    await getControlPool().query("SELECT 1");
    return jsonResponse({ data: { status: "ready" } });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.name : "unknown" },
      "Readiness check failed",
    );
    return jsonResponse({ data: { status: "unavailable" } }, { status: 503 });
  }
}
