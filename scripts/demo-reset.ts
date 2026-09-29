import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { closeControlPool } from "../src/infrastructure/db/control/pool";
import { closeTenantPools } from "../src/infrastructure/db/tenant/pool";
import { getServerConfig } from "../src/shared/config/env";

if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.NODE_ENV === "production" || process.env.CI)
  throw new Error("Demo reset is disabled in production and CI.");
if (!process.argv.includes("--confirm-demo"))
  throw new Error(
    "Reset requires explicit --confirm-demo. Stop pnpm dev first; this deletes only the local demo tenant and demo identities.",
  );
const config = getServerConfig();
if (
  config.PLATFORM_BASE_DOMAIN !== "localhost" ||
  new URL(config.BETTER_AUTH_URL).hostname !== "localhost"
)
  throw new Error("Demo reset requires localhost hostnames.");
for (const key of [
  "CONTROL_MIGRATION_DATABASE_URL",
  "CONTROL_QUEUE_DATABASE_URL",
  "TENANT_PROVISIONING_DATABASE_URL",
] as const) {
  if (
    !["127.0.0.1", "localhost", "::1"].includes(new URL(config[key]).hostname)
  )
    throw new Error("Demo reset requires local PostgreSQL only.");
}
const credentialPath = path.resolve(".demo-credentials.local");
if (!existsSync(credentialPath))
  throw new Error(
    "Demo credentials file is missing; refusing to reset an unverified tenant.",
  );
const credentials = JSON.parse(readFileSync(credentialPath, "utf8")) as {
  platform?: { email?: string };
};
if (credentials.platform?.email !== "demo-platform-admin@example.test")
  throw new Error(
    "Demo identity did not match the expected synthetic account.",
  );
const control = new Client({
  connectionString: config.CONTROL_MIGRATION_DATABASE_URL,
  application_name: "eventos-demo-reset",
});
const queue = new Client({
  connectionString: config.CONTROL_QUEUE_DATABASE_URL,
  application_name: "eventos-demo-reset",
});
const provisioner = new Client({
  connectionString: config.TENANT_PROVISIONING_DATABASE_URL,
  application_name: "eventos-demo-reset",
});
try {
  await Promise.all([
    control.connect(),
    queue.connect(),
    provisioner.connect(),
  ]);
  const result = await control.query<{
    id: string;
    database_name: string;
    admin_id: string;
    auth_user_id: string;
  }>(
    `SELECT tenant.id,registry.database_name,admin.id AS admin_id,admin.auth_user_id FROM tenants tenant
     JOIN tenant_database_registry registry ON registry.tenant_id=tenant.id
     JOIN platform_admins admin ON admin.id::text=tenant.created_by
     JOIN tenant_domains domain ON domain.tenant_id=tenant.id AND domain.is_primary
     WHERE tenant.slug='demo' AND domain.hostname='demo.localhost' AND admin.email=$1`,
    [credentials.platform.email],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error(
      "The local demo tenant ownership check failed; nothing was removed.",
    );
  if (row) {
    if (!/^eventos_t_[0-9a-f]{32}$/.test(row.database_name))
      throw new Error("Demo database name failed validation.");
    await queue.query(
      `DELETE FROM eventos_queue.job WHERE name='tenant.provision.v1' AND data->>'tenantId'=$1`,
      [row.id],
    );
    await closeTenantPools();
    await closeControlPool();
    const deadline = Date.now() + 10_000;
    for (;;) {
      const sessions = await provisioner.query<{
        pid: number;
        application_name: string;
        state: string | null;
      }>(
        "SELECT pid,application_name,state FROM pg_stat_activity WHERE datname=$1 ORDER BY pid",
        [row.database_name],
      );
      if (!sessions.rowCount) break;
      if (Date.now() >= deadline)
        throw new Error(
          `Close the local app before demo reset. Remaining sessions: ${JSON.stringify(sessions.rows)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await provisioner.query(`DROP DATABASE IF EXISTS "${row.database_name}"`);
    await control.query("BEGIN");
    try {
      await control.query(
        "DELETE FROM provisioning_job_transitions WHERE job_id IN (SELECT id FROM provisioning_jobs WHERE tenant_id=$1)",
        [row.id],
      );
      await control.query("DELETE FROM provisioning_jobs WHERE tenant_id=$1", [
        row.id,
      ]);
      await control.query(
        "DELETE FROM tenant_database_registry WHERE tenant_id=$1",
        [row.id],
      );
      await control.query("DELETE FROM tenants WHERE id=$1", [row.id]);
      await control.query("DELETE FROM platform_admins WHERE id=$1", [
        row.admin_id,
      ]);
      await control.query("DELETE FROM platform_auth_users WHERE id=$1", [
        row.auth_user_id,
      ]);
      await control.query("COMMIT");
    } catch (error) {
      await control.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  unlinkSync(credentialPath);
  console.log(
    "Local EventOS demo tenant and generated credentials were removed.",
  );
} finally {
  await Promise.all([control.end(), queue.end(), provisioner.end()]);
}
