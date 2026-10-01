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
  const phaseFive =
    row.migration_version === "0008_phase5_attendance_certificates" ||
    row.migration_version === "0009_phase6_payments" ||
    row.migration_version === "0010_phase6_coupon_reservations" ||
    row.migration_version === "0011_phase6_payment_lifecycle";
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
    attendance_records: number;
    certificates_issued: number;
    certificates_revoked: number;
    certificate_pdf_bytes: string;
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
      ${phaseFive ? "(SELECT count(*)::int FROM attendance_records WHERE tenant_id=$1)" : "0"} AS attendance_records,
      ${phaseFive ? "(SELECT count(*)::int FROM certificates WHERE tenant_id=$1 AND status='ACTIVE')" : "0"} AS certificates_issued,
      ${phaseFive ? "(SELECT count(*)::int FROM certificates WHERE tenant_id=$1 AND status='REVOKED')" : "0"} AS certificates_revoked,
      ${phaseFive ? "(SELECT COALESCE(sum(pdf_size_bytes),0)::text FROM certificates WHERE tenant_id=$1)" : "'0'"} AS certificate_pdf_bytes,
      pg_database_size(current_database())::text AS database_bytes`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}
