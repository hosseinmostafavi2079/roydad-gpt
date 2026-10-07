import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryResult } from "pg";
import { ZodError } from "zod";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { logger } from "@/infrastructure/logging/logger";
import {
  recordOperationalFailure,
  recordOperationalRecovery,
} from "@/modules/platform/diagnostics/service";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { DomainError } from "@/shared/errors/domain-error";
import { expirePaymentReservations } from "./lifecycle";
import { reconcileUnresolvedPayments } from "./service";

const lockName = "eventos-payment-maintenance-v1";
type TenantRecord = { tenant_id: string; database_name: string };

export async function runPaymentMaintenanceCycle(): Promise<{
  tenants: number;
  expired: number;
  reconciled: number;
  failures: number;
}> {
  const control = await getControlPool().connect();
  let locked = false;
  const requestId = randomUUID();
  const summary = { tenants: 0, expired: 0, reconciled: 0, failures: 0 };
  try {
    const attempt = await control.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
      [lockName],
    );
    locked = attempt.rows[0]?.locked === true;
    if (!locked) return summary;
    let cursor: string | null = null;
    for (;;) {
      const tenants: QueryResult<TenantRecord> =
        await control.query<TenantRecord>(
          `SELECT r.tenant_id,r.database_name
         FROM tenant_database_registry r JOIN tenants t ON t.id=r.tenant_id
         WHERE t.status IN ('ACTIVE','SUSPENDED')
           AND r.migration_version >= '0009_phase6_payments'
           AND ($1::uuid IS NULL OR r.tenant_id > $1::uuid)
         ORDER BY r.tenant_id LIMIT 100`,
          [cursor],
        );
      if (!tenants.rowCount) break;
      for (const row of tenants.rows) {
        cursor = row.tenant_id;
        const tenant = {
          tenantId: row.tenant_id,
          databaseName: row.database_name,
        } as TenantContext;
        try {
          const expired = await expirePaymentReservations(tenant, requestId);
          const reconciled = await reconcileUnresolvedPayments(
            tenant,
            requestId,
          );
          summary.tenants += 1;
          summary.expired += expired.expired;
          summary.reconciled += reconciled.updated;
          summary.failures += reconciled.failed;
          if (reconciled.failed === 0)
            await recordOperationalRecovery({
              code: "PAYMENT_RECONCILIATION_FAILED",
              tenantId: row.tenant_id,
              requestId,
            });
        } catch (error) {
          summary.failures += 1;
          if (!(error instanceof DomainError) && !(error instanceof ZodError))
            await recordOperationalFailure({
              code: "PAYMENT_RECONCILIATION_FAILED",
              tenantId: row.tenant_id,
              requestId,
            });
          logger.warn(
            {
              tenantId: row.tenant_id,
              requestId,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Payment maintenance tenant deferred",
          );
        }
      }
      if (tenants.rowCount < 100) break;
    }
    logger.info(
      { ...summary, requestId },
      "Payment maintenance cycle completed",
    );
    return summary;
  } finally {
    if (locked) {
      await control
        .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockName])
        .catch(() => undefined);
    }
    control.release();
  }
}
