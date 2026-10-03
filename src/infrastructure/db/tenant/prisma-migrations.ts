import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { getServerConfig } from "@/shared/config/env";

const databaseNamePattern = /^eventos_t_[0-9a-f]{32}$/;
const tenantIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const baselineMigration = "0000_phase1_baseline";
export const tenantIdentityMigrationVersion = "0002_tenant_identity_rbac";
export const tenantCurrentMigrationVersion = "0013_pilot_public_seo";

function migrationUrl(databaseName: string): string {
  if (!databaseNamePattern.test(databaseName)) {
    throw new Error("Tenant database identifier failed validation.");
  }
  const url = new URL(getServerConfig().TENANT_MIGRATION_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function runPrisma(databaseName: string, args: string[]): Promise<void> {
  const cli = path.join(
    process.cwd(),
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  if (!existsSync(cli)) {
    throw new Error("The tenant migration runtime is unavailable.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TENANT_PRISMA_DATABASE_URL: migrationUrl(databaseName),
      },
      stdio: "ignore",
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Tenant schema migration timed out."));
    }, 120_000);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Tenant schema migration could not start."));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("Tenant schema migration failed."));
    });
  });
}

export async function applyTenantPrismaMigrations(
  databaseName: string,
  tenantId: string,
): Promise<void> {
  if (!tenantIdPattern.test(tenantId)) {
    throw new Error("Tenant identity failed validation.");
  }
  const client = new Client({
    connectionString: migrationUrl(databaseName),
    application_name: "eventos-tenant-prisma-migration-check",
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const foundation = await client.query<{
      tenant_id: string;
      schema_version: string;
      has_foundation_migration: boolean;
    }>(
      `SELECT metadata.tenant_id, metadata.schema_version,
              EXISTS (SELECT 1 FROM tenant_schema_migrations WHERE version = '0001_tenant_foundation') AS has_foundation_migration
       FROM tenant_metadata AS metadata WHERE metadata.singleton = true`,
    );
    const current = foundation.rows[0];
    if (
      !current ||
      current.tenant_id !== tenantId ||
      (current.schema_version !== "0001_tenant_foundation" &&
        current.schema_version !== tenantIdentityMigrationVersion &&
        current.schema_version !== "0003_phase3_program_core" &&
        current.schema_version !== "0004_phase4_public_website" &&
        current.schema_version !== "0005_phase4_enrollment" &&
        current.schema_version !== "0006_phase4_self_registration_ids" &&
        current.schema_version !== "0007_organization_site_media" &&
        current.schema_version !== "0008_phase5_attendance_certificates" &&
        current.schema_version !== "0009_phase6_payments" &&
        current.schema_version !== "0010_phase6_coupon_reservations" &&
        current.schema_version !== "0011_phase6_payment_lifecycle" &&
        current.schema_version !== "0012_pilot_public_site" &&
        current.schema_version !== tenantCurrentMigrationVersion) ||
      !current.has_foundation_migration
    ) {
      throw new Error(
        "Tenant database is not at a recognized Phase 1 baseline.",
      );
    }

    const history = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists",
    );
    if (!history.rows[0]?.exists) {
      await runPrisma(databaseName, [
        "migrate",
        "resolve",
        "--applied",
        baselineMigration,
      ]);
    } else {
      const rows = await client.query<{
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }>(
        `SELECT migration_name, finished_at, rolled_back_at
         FROM public._prisma_migrations ORDER BY started_at`,
      );
      const baseline = rows.rows.find(
        (row) => row.migration_name === baselineMigration,
      );
      if (!baseline) {
        if (rows.rowCount) {
          throw new Error("Tenant Prisma migration history requires review.");
        }
        await runPrisma(databaseName, [
          "migrate",
          "resolve",
          "--applied",
          baselineMigration,
        ]);
      } else if (!baseline.finished_at || baseline.rolled_back_at) {
        throw new Error("Tenant Prisma baseline history is inconsistent.");
      }
    }

    await runPrisma(databaseName, ["migrate", "deploy"]);

    const phase3 = await client.query<{ tables_ready: boolean }>(
      `SELECT to_regclass('public.programs') IS NOT NULL
          AND to_regclass('public.program_runs') IS NOT NULL
          AND to_regclass('public.program_sessions') IS NOT NULL
          AND to_regclass('public.venues') IS NOT NULL
          AND to_regclass('public.rooms') IS NOT NULL AS tables_ready`,
    );
    if (!phase3.rows[0]?.tables_ready) {
      throw new Error("Tenant program schema verification failed.");
    }

    const phase4 = await client.query<{ ready: boolean }>(
      "SELECT to_regclass('public.tenant_website_profiles') IS NOT NULL AS ready",
    );
    if (!phase4.rows[0]?.ready) {
      throw new Error("Tenant public website schema verification failed.");
    }
    const enrollment = await client.query<{ ready: boolean }>(
      "SELECT to_regclass('public.enrollments') IS NOT NULL AS ready",
    );
    if (!enrollment.rows[0]?.ready) {
      throw new Error("Tenant enrollment schema verification failed.");
    }
    const media = await client.query<{ ready: boolean }>(
      "SELECT to_regclass('public.tenant_media') IS NOT NULL AS ready",
    );
    if (!media.rows[0]?.ready)
      throw new Error("Tenant media schema verification failed.");

    const operations = await client.query<{ ready: boolean }>(
      `SELECT to_regclass('public.attendance_records') IS NOT NULL
          AND to_regclass('public.attendance_qr_challenges') IS NOT NULL
          AND to_regclass('public.attendance_qr_uses') IS NOT NULL
          AND to_regclass('public.certificate_templates') IS NOT NULL
          AND to_regclass('public.certificates') IS NOT NULL AS ready`,
    );
    if (!operations.rows[0]?.ready)
      throw new Error(
        "Tenant attendance/certificate schema verification failed.",
      );

    const commerce = await client.query<{ ready: boolean }>(
      `SELECT to_regclass('public.payments') IS NOT NULL
          AND to_regclass('public.payment_attempts') IS NOT NULL
          AND to_regclass('public.payment_provider_configs') IS NOT NULL
          AND to_regclass('public.coupons') IS NOT NULL
          AND to_regclass('public.invoices') IS NOT NULL
          AND to_regclass('public.refunds') IS NOT NULL AS ready`,
    );
    if (!commerce.rows[0]?.ready)
      throw new Error("Tenant payment schema verification failed.");
    const couponReservations = await client.query<{ ready: boolean }>(
      "SELECT to_regclass('public.coupon_reservations') IS NOT NULL AS ready",
    );
    if (!couponReservations.rows[0]?.ready)
      throw new Error("Tenant coupon schema verification failed.");

    const pilotSite = await client.query<{ ready: boolean }>(
      `SELECT to_regclass('public.tenant_instructor_public_profiles') IS NOT NULL
          AND to_regclass('public.tenant_information_pages') IS NOT NULL
          AND to_regclass('public.tenant_site_entries') IS NOT NULL AS ready`,
    );
    if (!pilotSite.rows[0]?.ready)
      throw new Error("Tenant public site schema verification failed.");

    await client.query("BEGIN");
    const verification = await client.query<{
      permission_count: number;
      system_role_count: number;
      owner_grant_count: number;
      required_permissions: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM tenant_permissions WHERE tenant_id = $1) AS permission_count,
         (SELECT count(*)::int FROM tenant_roles WHERE tenant_id = $1 AND is_system = true) AS system_role_count,
         (SELECT count(*)::int FROM tenant_role_permissions AS rp
          JOIN tenant_roles AS role ON role.tenant_id = rp.tenant_id AND role.id = rp.role_id
          WHERE role.tenant_id = $1 AND role.code = 'organization_owner') AS owner_grant_count,
         (SELECT count(*)::int FROM tenant_permissions WHERE tenant_id = $1
          AND key IN ('dashboard.read', 'staff.read', 'role.manage', 'attendance.manage', 'finance.read', 'settings.manage')) AS required_permissions`,
      [tenantId],
    );
    const row = verification.rows[0];
    if (
      row?.system_role_count !== 11 ||
      row.permission_count < 40 ||
      row.owner_grant_count !== row.permission_count ||
      row.required_permissions !== 6
    ) {
      throw new Error(
        "Tenant identity and RBAC migration verification failed.",
      );
    }
    await client.query(
      `UPDATE tenant_metadata SET schema_version = $2
       WHERE singleton = true AND tenant_id = $1`,
      [tenantId, tenantCurrentMigrationVersion],
    );
    await client.query(
      `INSERT INTO tenant_schema_migrations(version) VALUES ($1)
       ON CONFLICT (version) DO NOTHING`,
      [tenantCurrentMigrationVersion],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
