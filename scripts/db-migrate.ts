import { existsSync } from "node:fs";
import { Client } from "pg";
import path from "node:path";
import { getServerConfig } from "../src/shared/config/env";
import { applySqlMigrations } from "../src/infrastructure/db/migrations/runner";
import { logger } from "../src/infrastructure/logging/logger";

if (existsSync(".env")) process.loadEnvFile(".env");

const config = getServerConfig();
const client = new Client({
  connectionString: config.CONTROL_MIGRATION_DATABASE_URL,
  application_name: "eventos-control-plane-migrations",
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  await applySqlMigrations(
    client,
    path.join(
      process.cwd(),
      "src",
      "infrastructure",
      "db",
      "control",
      "migrations",
    ),
    "eventos-control-plane-migrations",
  );
  logger.info("Control-plane migrations are up to date");
} catch (error) {
  logger.error(
    {
      errorName: error instanceof Error ? error.name : "unknown",
      errorCode:
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined,
    },
    "Control-plane migration command failed",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
