import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { getServerConfig } from "../src/shared/config/env";
import { hashPlatformPassword } from "../src/infrastructure/auth/password";
import { logger } from "../src/infrastructure/logging/logger";

if (existsSync(".env")) process.loadEnvFile(".env");
const config = getServerConfig();
if (config.NODE_ENV === "production") {
  throw new Error(
    "The synthetic administrator bootstrap is disabled in production.",
  );
}

const email = process.env.PLATFORM_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_BOOTSTRAP_ADMIN_PASSWORD;
if (
  !email ||
  !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
  !password ||
  password.length < 24 ||
  password.length > 128
) {
  throw new Error(
    "Set a valid bootstrap email and a unique local password of at least 24 characters.",
  );
}

const client = new Client({
  connectionString: config.CONTROL_MIGRATION_DATABASE_URL,
  application_name: "eventos-admin-bootstrap",
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('eventos-bootstrap-admin', 0))",
  );
  const existing = await client.query(
    "SELECT id FROM platform_admins WHERE email = $1",
    [email],
  );
  if (existing.rowCount) {
    await client.query("COMMIT");
    logger.info(
      { adminId: existing.rows[0]?.id },
      "Synthetic platform administrator already exists",
    );
  } else {
    const userId = randomUUID();
    const adminId = randomUUID();
    const now = new Date();
    const hash = await hashPlatformPassword(password);
    await client.query(
      `INSERT INTO platform_auth_users (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, $4, $4)`,
      [userId, "Local Platform Administrator", email, now],
    );
    await client.query(
      `INSERT INTO platform_auth_accounts (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
      [randomUUID(), userId, hash, now],
    );
    await client.query(
      `INSERT INTO platform_admins (id, auth_user_id, email, display_name) VALUES ($1, $2, $3, $4)`,
      [adminId, userId, email, "Local Platform Administrator"],
    );
    await client.query("COMMIT");
    logger.info({ adminId }, "Synthetic platform administrator created");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  logger.error(
    { error: error instanceof Error ? { name: error.name } : "unknown" },
    "Administrator bootstrap failed",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
