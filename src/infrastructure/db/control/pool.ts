import "server-only";

import { Pool } from "pg";
import { getServerConfig } from "@/shared/config/env";
import { logger } from "@/infrastructure/logging/logger";

const globalForControlPool = globalThis as typeof globalThis & {
  eventosControlPool?: Pool;
};

export function getControlPool(): Pool {
  if (globalForControlPool.eventosControlPool) {
    return globalForControlPool.eventosControlPool;
  }

  const config = getServerConfig();
  const pool = new Pool({
    connectionString: config.CONTROL_DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: "eventos-platform-web",
    allowExitOnIdle: config.NODE_ENV !== "production",
  });
  pool.on("error", (error) => {
    logger.error(
      {
        error: {
          name: error.name,
          code: "code" in error ? error.code : undefined,
        },
      },
      "Control database pool error",
    );
  });

  globalForControlPool.eventosControlPool = pool;
  return pool;
}

export async function closeControlPool(): Promise<void> {
  const pool = globalForControlPool.eventosControlPool;
  if (!pool) return;
  delete globalForControlPool.eventosControlPool;
  await pool.end();
}
