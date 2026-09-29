import { existsSync } from "node:fs";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { getServerConfig } from "../src/shared/config/env";
import { applySqlMigrations } from "../src/infrastructure/db/migrations/runner";
import {
  applyTenantPrismaMigrations,
  tenantIdentityMigrationVersion,
} from "../src/infrastructure/db/tenant/prisma-migrations";
import { decryptTenantOwnerBootstrap } from "../src/infrastructure/auth/tenant-bootstrap";
import {
  clearOwnerBootstrap,
  issueInitialTenantOwnerInvitation,
} from "../src/modules/tenant-identity/repository";
import { getTenantPool } from "../src/infrastructure/db/tenant/pool";
import {
  getProvisioningBoss,
  provisioningQueueName,
  stopProvisioningBoss,
} from "../src/modules/platform/provisioning/queue";
import { getControlPool } from "../src/infrastructure/db/control/pool";
import { logger } from "../src/infrastructure/logging/logger";

if (existsSync(".env")) process.loadEnvFile(".env");
const config = getServerConfig();
const databaseNamePattern = /^eventos_t_[0-9a-f]{32}$/;
type Phase = "DATABASE_CREATING" | "MIGRATING" | "SEEDING" | "VERIFYING";

function testFailureAt(phase: Phase): void {
  if (
    config.NODE_ENV === "test" &&
    process.env.EVENTOS_TEST_FAIL_PHASE === phase
  ) {
    delete process.env.EVENTOS_TEST_FAIL_PHASE;
    throw new Error("Test-only provisioning failure injection.");
  }
}

const safeReasons: Readonly<Record<string, string>> = {
  "Tenant database identifier failed validation.":
    "invalid_database_identifier",
  "Existing tenant database has an unexpected owner.":
    "unexpected_database_owner",
  "Tenant database verification did not match expected metadata.":
    "tenant_metadata_mismatch",
  "Tenant baseline role templates do not match the reviewed seed.":
    "tenant_seed_mismatch",
  "Test-only provisioning failure injection.": "test_failure_injected",
};

function safeFailureDetails(error: unknown): Readonly<Record<string, string>> {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.code)
      ? error.code
      : undefined;
  const reason =
    error instanceof Error ? safeReasons[error.message] : undefined;
  return {
    ...(error instanceof Error
      ? { errorName: error.name }
      : { errorName: "unknown" }),
    ...(code ? { errorCode: code } : {}),
    ...(reason ? { reason } : {}),
  };
}

function quoteIdentifier(value: string): string {
  if (!databaseNamePattern.test(value))
    throw new Error("Tenant database identifier failed validation.");
  return `"${value}"`;
}

function tenantOrigin(hostname: string): string {
  const platformOrigin = new URL(config.BETTER_AUTH_URL);
  const port = platformOrigin.port ? `:${platformOrigin.port}` : "";
  return `${platformOrigin.protocol}//${hostname}${port}`;
}

async function transition(
  jobId: string,
  tenantId: string,
  toState:
    | Phase
    | "ACTIVE"
    | `FAILED_${"DATABASE" | "MIGRATION" | "SEED" | "VERIFICATION"}`,
  requestId: string,
) {
  const client = await getControlPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      state: string;
      attempt_count: number;
    }>(
      "SELECT state, attempt_count FROM provisioning_jobs WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
      [jobId, tenantId],
    );
    const job = current.rows[0];
    if (!job) throw new Error("Provisioning record is missing.");
    if (job.state === "ACTIVE") {
      await client.query("COMMIT");
      return false;
    }
    const sequence = await client.query<{ next_sequence: number }>(
      "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence FROM provisioning_job_transitions WHERE job_id = $1",
      [jobId],
    );
    const nextSequence = sequence.rows[0]?.next_sequence ?? 1;
    await client.query(
      `UPDATE provisioning_jobs SET state = $2, error_code = NULL, error_message = NULL,
         started_at = COALESCE(started_at, now()), completed_at = CASE WHEN $3 THEN now() ELSE completed_at END,
         updated_at = now() WHERE id = $1`,
      [jobId, toState, toState === "ACTIVE"],
    );
    await client.query(
      `INSERT INTO provisioning_job_transitions
         (job_id, sequence_number, from_state, to_state, actor_id, request_id)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [jobId, nextSequence, job.state, toState, requestId],
    );
    if (toState === "ACTIVE") {
      await client.query(
        "UPDATE tenants SET status = 'ACTIVE', updated_at = now() WHERE id = $1",
        [tenantId],
      );
      await client.query(
        `UPDATE tenant_database_registry SET last_health_state = 'HEALTHY', last_health_check_at = now(),
           migration_version = $2 WHERE tenant_id = $1`,
        [tenantId, tenantIdentityMigrationVersion],
      );
    } else if (toState.startsWith("FAILED_")) {
      await client.query(
        "UPDATE tenants SET status = 'FAILED', updated_at = now() WHERE id = $1",
        [tenantId],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function databaseExists(databaseName: string): Promise<boolean> {
  const client = new Client({
    connectionString: config.TENANT_PROVISIONING_DATABASE_URL,
    application_name: "eventos-provision-check",
  });
  try {
    await client.connect();
    const result = await client.query<{ owner: string }>(
      "SELECT role.rolname AS owner FROM pg_database AS db JOIN pg_roles AS role ON role.oid = db.datdba WHERE db.datname = $1",
      [databaseName],
    );
    if (!result.rowCount) return false;
    if (result.rows[0]?.owner !== "eventos_tenant_owner")
      throw new Error("Existing tenant database has an unexpected owner.");
    return true;
  } finally {
    await client.end();
  }
}

async function createTenantDatabase(databaseName: string) {
  const client = new Client({
    connectionString: config.TENANT_PROVISIONING_DATABASE_URL,
    application_name: "eventos-tenant-create",
  });
  try {
    await client.connect();
    if (!(await databaseExists(databaseName))) {
      await client.query(
        `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER eventos_tenant_owner`,
      );
    }
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO eventos_tenant_runtime, eventos_tenant_migrator`,
    );
  } finally {
    await client.end();
  }
}

async function applyTenantMigrations(
  databaseName: string,
  tenantId: string,
  slug: string,
) {
  const url = new URL(config.TENANT_MIGRATION_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  const client = new Client({
    connectionString: url.toString(),
    application_name: "eventos-tenant-migrations",
  });
  try {
    await client.connect();
    await client.query("SET ROLE eventos_tenant_owner");
    await applySqlMigrations(
      client,
      fileURLToPath(
        new URL("../src/infrastructure/db/tenant/migrations/", import.meta.url),
      ),
      `tenant-${tenantId}`,
    );
    await client.query(
      "GRANT USAGE ON SCHEMA public TO eventos_tenant_runtime",
    );
    await client.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eventos_tenant_runtime",
    );
    await client.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eventos_tenant_runtime",
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eventos_tenant_runtime",
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eventos_tenant_runtime",
    );
    return { version: "0001_tenant_foundation", tenantId, slug };
  } finally {
    await client.end();
  }
}

async function verifyTenantDatabase(
  databaseName: string,
  tenantId: string,
  slug: string,
) {
  const url = new URL(config.TENANT_RUNTIME_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  const client = new Client({
    connectionString: url.toString(),
    application_name: "eventos-tenant-verify",
  });
  try {
    await client.connect();
    const metadata = await client.query<{ tenant_id: string; slug: string }>(
      "SELECT tenant_id, slug FROM tenant_metadata WHERE singleton = true",
    );
    const identity = await client.query<{
      schema_version: string;
      role_count: number;
      permission_count: number;
      owner_grant_count: number;
      has_owner: boolean;
    }>(
      `SELECT metadata.schema_version,
              (SELECT count(*)::int FROM tenant_roles WHERE tenant_id = metadata.tenant_id) AS role_count,
              (SELECT count(*)::int FROM tenant_permissions WHERE tenant_id = metadata.tenant_id) AS permission_count,
              (SELECT count(*)::int FROM tenant_role_permissions AS rp JOIN tenant_roles AS role
                ON role.tenant_id = rp.tenant_id AND role.id = rp.role_id
               WHERE role.tenant_id = metadata.tenant_id AND role.code = 'organization_owner') AS owner_grant_count,
              EXISTS (SELECT 1 FROM tenant_roles WHERE tenant_id = metadata.tenant_id AND code = 'organization_owner') AS has_owner
       FROM tenant_metadata AS metadata WHERE metadata.singleton = true`,
    );
    const roles = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM tenant_role_templates",
    );
    if (
      metadata.rows[0]?.tenant_id !== tenantId ||
      metadata.rows[0]?.slug !== slug
    ) {
      throw new Error(
        "Tenant database verification did not match expected metadata.",
      );
    }
    if (roles.rows[0]?.count !== 11) {
      throw new Error(
        "Tenant baseline role templates do not match the reviewed seed.",
      );
    }
    const schema = identity.rows[0];
    if (
      schema?.schema_version !== tenantIdentityMigrationVersion ||
      schema.role_count !== 11 ||
      schema.permission_count < 40 ||
      schema.owner_grant_count !== schema.permission_count ||
      !schema.has_owner
    ) {
      throw new Error("Tenant identity schema verification failed.");
    }
  } finally {
    await client.end();
  }
}

async function seedTenantDatabase(
  databaseName: string,
  tenantId: string,
  slug: string,
): Promise<void> {
  const url = new URL(config.TENANT_MIGRATION_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  const client = new Client({
    connectionString: url.toString(),
    application_name: "eventos-tenant-seed",
  });
  try {
    await client.connect();
    await client.query("SET ROLE eventos_tenant_owner");
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenant_metadata (singleton, tenant_id, slug, schema_version)
       VALUES (true, $1, $2, '0001_tenant_foundation')
       ON CONFLICT (singleton) DO NOTHING`,
      [tenantId, slug],
    );
    await client.query(
      `INSERT INTO tenant_schema_migrations (version)
       VALUES ('0001_tenant_foundation') ON CONFLICT (version) DO NOTHING`,
    );
    await client.query("COMMIT");
    await client.query("RESET ROLE");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function provision(jobId: string, tenantId: string) {
  const lock = await getControlPool().connect();
  let phase: Phase = "DATABASE_CREATING";
  let requestId = "00000000-0000-4000-8000-000000000000";
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      `tenant-provision:${tenantId}`,
    ]);
    const data = await lock.query<{
      database_name: string;
      slug: string;
      state: string;
      request_id: string;
      owner_bootstrap_ciphertext: Buffer | null;
    }>(
      `SELECT registry.database_name, tenant.slug, job.state, job.request_id,
              job.owner_bootstrap_ciphertext
       FROM provisioning_jobs AS job JOIN tenants AS tenant ON tenant.id = job.tenant_id
       JOIN tenant_database_registry AS registry ON registry.tenant_id = tenant.id
       WHERE job.id = $1 AND tenant.id = $2`,
      [jobId, tenantId],
    );
    const record = data.rows[0];
    if (!record) throw new Error("Provisioning record is missing.");
    requestId = record.request_id;
    if (!databaseNamePattern.test(record.database_name))
      throw new Error("Tenant database identifier failed validation.");
    if (record.state === "ACTIVE") return;

    phase = "DATABASE_CREATING";
    await transition(jobId, tenantId, phase, requestId);
    testFailureAt(phase);
    await createTenantDatabase(record.database_name);

    phase = "MIGRATING";
    await transition(jobId, tenantId, phase, requestId);
    testFailureAt(phase);
    await applyTenantMigrations(record.database_name, tenantId, record.slug);

    phase = "SEEDING";
    await transition(jobId, tenantId, phase, requestId);
    testFailureAt(phase);
    await seedTenantDatabase(record.database_name, tenantId, record.slug);
    await applyTenantPrismaMigrations(record.database_name, tenantId);
    if (record.owner_bootstrap_ciphertext) {
      const owner = decryptTenantOwnerBootstrap(
        tenantId,
        record.owner_bootstrap_ciphertext,
      );
      await issueInitialTenantOwnerInvitation(
        {
          tenantId,
          databaseName: record.database_name,
          hostname: `${record.slug}.${config.PLATFORM_BASE_DOMAIN}`,
          branding: {
            brandName: record.slug,
            primaryColor: "#145D58",
            accentColor: "#C99047",
          },
        },
        owner,
        requestId,
        tenantOrigin(`${record.slug}.${config.PLATFORM_BASE_DOMAIN}`),
        true,
      );
      await clearOwnerBootstrap(jobId);
    } else {
      const ownerCheck = await getTenantPool({
        tenantId,
        databaseName: record.database_name,
      }).query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM tenant_user_roles AS user_role
           JOIN tenant_roles AS role ON role.tenant_id = user_role.tenant_id AND role.id = user_role.role_id
           WHERE user_role.tenant_id = $1 AND role.code = 'organization_owner'
         ) AS exists`,
        [tenantId],
      );
      if (!ownerCheck.rows[0]?.exists) {
        throw new Error("Initial tenant owner invitation is missing.");
      }
    }

    phase = "VERIFYING";
    await transition(jobId, tenantId, phase, requestId);
    testFailureAt(phase);
    await verifyTenantDatabase(record.database_name, tenantId, record.slug);

    await transition(jobId, tenantId, "ACTIVE", requestId);
    logger.info({ jobId, tenantId }, "Tenant provisioning completed");
  } catch (error) {
    const failure =
      phase === "DATABASE_CREATING"
        ? "FAILED_DATABASE"
        : phase === "MIGRATING"
          ? "FAILED_MIGRATION"
          : phase === "SEEDING"
            ? "FAILED_SEED"
            : "FAILED_VERIFICATION";
    let failurePersisted = true;
    const client = await getControlPool().connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ state: string }>(
        "SELECT state FROM provisioning_jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      if (current.rows[0]?.state !== "ACTIVE") {
        const sequence = await client.query<{ next_sequence: number }>(
          "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence FROM provisioning_job_transitions WHERE job_id = $1",
          [jobId],
        );
        await client.query(
          `UPDATE provisioning_jobs SET state = $2, error_code = $3,
             error_message = 'Tenant provisioning failed; inspect platform health and retry.', updated_at = now()
           WHERE id = $1`,
          [jobId, failure, failure],
        );
        await client.query(
          `INSERT INTO provisioning_job_transitions
             (job_id, sequence_number, from_state, to_state, actor_id, request_id, safe_detail)
           VALUES ($1, $2, $3, $4, NULL, $5, '{"reason":"worker_failure"}'::jsonb)`,
          [
            jobId,
            sequence.rows[0]?.next_sequence ?? 1,
            current.rows[0]?.state ?? null,
            failure,
            requestId,
          ],
        );
        await client.query(
          "UPDATE tenants SET status = 'FAILED', updated_at = now() WHERE id = $1",
          [tenantId],
        );
      }
      await client.query("COMMIT");
    } catch (_persistError) {
      failurePersisted = false;
      await client.query("ROLLBACK").catch(() => undefined);
      logger.error(
        { jobId, tenantId },
        "Could not persist provisioning failure state",
      );
    } finally {
      client.release();
    }
    logger.error(
      {
        jobId,
        tenantId,
        phase,
        ...safeFailureDetails(error),
      },
      "Tenant provisioning failed",
    );
    if (!failurePersisted) {
      throw new Error("Provisioning failure state could not be stored.");
    }
  } finally {
    await lock
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        `tenant-provision:${tenantId}`,
      ])
      .catch(() => undefined);
    lock.release();
  }
}

const boss = await getProvisioningBoss();
const workerId = await boss.work<{
  provisioningJobId: string;
  tenantId: string;
}>(
  provisioningQueueName,
  { batchSize: 1, pollingIntervalSeconds: 2 },
  async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    await provision(job.data.provisioningJobId, job.data.tenantId);
  },
);
logger.info("Provisioning worker started");
process.send?.({ type: "eventos.provisioning.ready" });
const shutdown = async () => {
  await boss.offWork(provisioningQueueName, { id: workerId, wait: true });
  await stopProvisioningBoss();
  await getControlPool().end();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
