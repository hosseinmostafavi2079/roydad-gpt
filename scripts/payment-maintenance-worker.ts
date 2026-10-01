import { existsSync } from "node:fs";
import { closeControlPool } from "../src/infrastructure/db/control/pool";
import { closeTenantPools } from "../src/infrastructure/db/tenant/pool";
import { logger } from "../src/infrastructure/logging/logger";
import { runPaymentMaintenanceCycle } from "../src/modules/payments/maintenance";

if (existsSync(".env")) process.loadEnvFile(".env");

let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let active: Promise<void> | undefined;
let shutdownPromise: Promise<void> | undefined;

function schedule(): void {
  if (stopping) return;
  timer = setTimeout(() => {
    active = (async () => {
      try {
        await runPaymentMaintenanceCycle();
      } catch (error) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "Payment maintenance cycle failed",
        );
      } finally {
        active = undefined;
        schedule();
      }
    })();
  }, 60_000);
}

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    await active;
    await closeTenantPools();
    await closeControlPool();
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
logger.info("Payment maintenance worker started");
process.send?.({ type: "eventos.payment-maintenance.ready" });
schedule();
