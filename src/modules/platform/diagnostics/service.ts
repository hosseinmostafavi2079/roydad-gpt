import "server-only";
import { logger } from "@/infrastructure/logging/logger";
import { DiagnosticsRepository } from "./repository";
import type { DiagnosticInput } from "./schema";

// Optional instrumentation must never change business-operation results.
export async function recordOperationalFailure(input: DiagnosticInput) {
  try {
    await new DiagnosticsRepository().recordOperationalFailure(input);
  } catch {
    logger.warn(
      { eventCode: "DIAGNOSTICS_WRITE_UNAVAILABLE" },
      "Diagnostic recording unavailable",
    );
  }
}
export async function recordOperationalRecovery(input: DiagnosticInput) {
  try {
    await new DiagnosticsRepository().recordOperationalRecovery(input);
  } catch {
    logger.warn(
      { eventCode: "DIAGNOSTICS_WRITE_UNAVAILABLE" },
      "Diagnostic recording unavailable",
    );
  }
}
export async function upsertComponentHeartbeat(
  component: "MAIN_WORKER" | "BACKUP_RUNNER",
  warn: () => void = () =>
    logger.warn(
      { eventCode: "DIAGNOSTICS_WRITE_UNAVAILABLE" },
      "Diagnostic heartbeat unavailable",
    ),
) {
  try {
    await new DiagnosticsRepository().upsertComponentHeartbeat(component);
  } catch {
    warn();
  }
}
