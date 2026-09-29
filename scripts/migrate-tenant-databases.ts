import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getControlPool } from "../src/infrastructure/db/control/pool";
import {
  applyTenantPrismaMigrations,
  tenantCurrentMigrationVersion,
  tenantIdentityMigrationVersion,
} from "../src/infrastructure/db/tenant/prisma-migrations";
import { logger } from "../src/infrastructure/logging/logger";

if (existsSync(".env")) process.loadEnvFile(".env");
const databaseNamePattern = /^eventos_t_[0-9a-f]{32}$/;
const migrationFailureReasons = new Map([
  [
    "Tenant database identifier failed validation.",
    "invalid_database_identifier",
  ],
  [
    "Tenant migration version requires review.",
    "unknown_registry_migration_version",
  ],
  [
    "Tenant database is not at a recognized Phase 1 baseline.",
    "unrecognized_tenant_baseline",
  ],
  [
    "Tenant Prisma migration history requires review.",
    "prisma_history_requires_review",
  ],
  [
    "Tenant Prisma baseline history is inconsistent.",
    "prisma_baseline_inconsistent",
  ],
  [
    "Tenant identity and RBAC migration verification failed.",
    "phase2_schema_verification_failed",
  ],
  [
    "Tenant schema migration runtime is unavailable.",
    "migration_runtime_unavailable",
  ],
  ["Tenant schema migration timed out.", "migration_timeout"],
  ["Tenant schema migration could not start.", "migration_process_unavailable"],
  ["Tenant schema migration failed.", "migration_process_failed"],
]);

const tenants = await getControlPool().query<{
  tenant_id: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  database_name: string;
  migration_version: string | null;
}>(
  `SELECT tenant.id AS tenant_id, tenant.slug, tenant.status,
          registry.database_name, registry.migration_version
   FROM tenants AS tenant JOIN tenant_database_registry AS registry ON registry.tenant_id = tenant.id
   WHERE tenant.status IN ('ACTIVE', 'SUSPENDED') ORDER BY tenant.id`,
);

let failures = 0;
for (const tenant of tenants.rows) {
  const lock = await getControlPool().connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      `tenant-provision:${tenant.tenant_id}`,
    ]);
    if (!databaseNamePattern.test(tenant.database_name)) {
      throw new Error("Tenant database identifier failed validation.");
    }
    if (
      tenant.migration_version !== "0001_tenant_foundation" &&
      tenant.migration_version !== tenantIdentityMigrationVersion &&
      tenant.migration_version !== tenantCurrentMigrationVersion
    ) {
      throw new Error("Tenant migration version requires review.");
    }
    await applyTenantPrismaMigrations(tenant.database_name, tenant.tenant_id);
    if (tenant.migration_version === tenantCurrentMigrationVersion) {
      logger.info(
        {
          tenantId: tenant.tenant_id,
          migrationVersion: tenantCurrentMigrationVersion,
        },
        "Tenant database is already at the current schema version",
      );
      continue;
    }
    const client = await getControlPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE tenant_database_registry SET migration_version = $2,
           last_health_state = 'HEALTHY', last_health_check_at = now()
         WHERE tenant_id = $1`,
        [tenant.tenant_id, tenantCurrentMigrationVersion],
      );
      await client.query(
        `INSERT INTO platform_audit_logs
           (actor_type, actor_id, action, target_type, target_id, request_id, before_state, after_state)
         VALUES ('SYSTEM', NULL, 'tenant.schema_migrated', 'TENANT', $1, $2, $3::jsonb, $4::jsonb)`,
        [
          tenant.tenant_id,
          randomUUID(),
          JSON.stringify({ migrationVersion: tenant.migration_version }),
          JSON.stringify({ migrationVersion: tenantCurrentMigrationVersion }),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    logger.info(
      {
        tenantId: tenant.tenant_id,
        migrationVersion: tenantCurrentMigrationVersion,
      },
      "Tenant database migration completed",
    );
  } catch (error) {
    failures += 1;
    logger.error(
      {
        tenantId: tenant.tenant_id,
        errorName: error instanceof Error ? error.name : "unknown",
        errorCode:
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined,
        reason:
          error instanceof Error
            ? (migrationFailureReasons.get(error.message) ?? "unexpected_error")
            : "unknown_error",
      },
      "Tenant database migration failed",
    );
  } finally {
    await lock
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        `tenant-provision:${tenant.tenant_id}`,
      ])
      .catch(() => undefined);
    lock.release();
  }
}

await getControlPool().end();
if (failures) process.exitCode = 1;
else
  logger.info(
    { count: tenants.rowCount },
    "Tenant database migrations are up to date",
  );
