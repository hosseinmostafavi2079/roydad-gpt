import { existsSync } from "node:fs";
import { closeControlPool } from "../src/infrastructure/db/control/pool";
import { closeTenantPools } from "../src/infrastructure/db/tenant/pool";
import { runPaymentMaintenanceCycle } from "../src/modules/payments/maintenance";

if (existsSync(".env")) process.loadEnvFile(".env");
try {
  await runPaymentMaintenanceCycle();
} finally {
  await closeTenantPools();
  await closeControlPool();
}
