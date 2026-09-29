import "server-only";

import { getControlPool } from "@/infrastructure/db/control/pool";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { DomainError } from "@/shared/errors/domain-error";

export async function getTenantUsage(tenantId: string) {
  const registry = await getControlPool().query<{
    database_name: string;
    migration_version: string | null;
  }>(
    "SELECT database_name,migration_version FROM tenant_database_registry WHERE tenant_id=$1",
    [tenantId],
  );
  const row = registry.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", "Tenant not found.");
  if (!row.migration_version) return null;
  const result = await getTenantPool({
    tenantId,
    databaseName: row.database_name,
  }).query<{
    staff: number;
    participants: number;
    instructors: number;
    programs: number;
    active_runs: number;
    sessions: number;
    enrollments: number;
    database_bytes: string;
  }>(
    `SELECT
      (SELECT count(*)::int FROM tenant_staff_profiles WHERE tenant_id=$1) AS staff,
      (SELECT count(*)::int FROM tenant_participant_profiles WHERE tenant_id=$1) AS participants,
      (SELECT count(*)::int FROM tenant_instructor_profiles WHERE tenant_id=$1) AS instructors,
      (SELECT count(*)::int FROM programs WHERE tenant_id=$1 AND status<>'ARCHIVED') AS programs,
      (SELECT count(*)::int FROM program_runs WHERE tenant_id=$1 AND state='PUBLISHED') AS active_runs,
      (SELECT count(*)::int FROM program_sessions WHERE tenant_id=$1 AND status='SCHEDULED') AS sessions,
      (SELECT count(*)::int FROM enrollments WHERE tenant_id=$1 AND status IN ('CONFIRMED','WAITLISTED')) AS enrollments,
      pg_database_size(current_database())::text AS database_bytes`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}
