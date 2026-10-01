import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";

export async function expirePaymentReservations(
  tenant: TenantContext,
  requestId: string,
  limit = 50,
): Promise<{ examined: number; expired: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid expiration batch size.");
  const pool = getTenantPool(tenant);
  const candidates = await pool.query<{ id: string; enrollment_id: string }>(
    `SELECT p.id,p.enrollment_id FROM payments p
     JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
     WHERE p.tenant_id=$1 AND e.status='AWAITING_PAYMENT'
       AND e.payment_expires_at <= now()
     ORDER BY e.payment_expires_at,p.id LIMIT $2`,
    [tenant.tenantId, limit],
  );
  let expired = 0;
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const payment = await client.query<{ state: string }>(
        "SELECT state FROM payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tenant.tenantId, candidate.id],
      );
      const enrollment = await client.query<{
        status: string;
        payment_expires_at: Date | null;
      }>(
        "SELECT status,payment_expires_at FROM enrollments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tenant.tenantId, candidate.enrollment_id],
      );
      const current = enrollment.rows[0];
      if (
        !payment.rows[0] ||
        current?.status !== "AWAITING_PAYMENT" ||
        !current.payment_expires_at ||
        current.payment_expires_at > new Date()
      ) {
        await client.query("COMMIT");
        continue;
      }
      await client.query(
        "UPDATE enrollments SET status='EXPIRED',updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenant.tenantId, candidate.enrollment_id],
      );
      if (
        !["SUCCEEDED", "REFUND_PENDING", "REFUNDED"].includes(
          payment.rows[0].state,
        )
      ) {
        await client.query(
          "UPDATE payments SET state='EXPIRED',updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tenant.tenantId, candidate.id],
        );
      }
      await client.query(
        "UPDATE coupon_reservations SET status='RELEASED',updated_at=now() WHERE tenant_id=$1 AND payment_id=$2 AND status='ACTIVE'",
        [tenant.tenantId, candidate.id],
      );
      await client.query(
        `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
         VALUES ($1,NULL,'payment.reservation_expired','PAYMENT',$2,$3,$4::jsonb)`,
        [
          tenant.tenantId,
          candidate.id,
          requestId,
          JSON.stringify({ enrollmentId: candidate.enrollment_id }),
        ],
      );
      await client.query("COMMIT");
      expired += 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return { examined: candidates.rowCount ?? 0, expired };
}
