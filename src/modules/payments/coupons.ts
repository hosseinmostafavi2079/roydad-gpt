import "server-only";

import { randomUUID } from "node:crypto";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";

type Scope = Readonly<{
  tenant: TenantContext;
  actor: TenantActor;
  requestId: string;
}>;

export async function createCoupon(
  scope: Scope,
  input: Readonly<{
    code: string;
    discountType: "FIXED" | "PERCENT";
    discountValue: bigint;
    currency: string;
    maxUses: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }>,
) {
  if (
    scope.actor.tenantId !== scope.tenant.tenantId ||
    !scope.tenant.features.payments
  )
    throw new Error("Coupons are unavailable.");
  authorize(scope.actor.permissions, "payment.manage");
  const code = input.code.trim().toUpperCase();
  if (
    !/^[A-Z0-9_-]{3,64}$/.test(code) ||
    !/^[A-Z]{3}$/.test(input.currency) ||
    input.discountValue <= 0n ||
    (input.discountType === "PERCENT" && input.discountValue > 10000n) ||
    (input.maxUses !== null &&
      (!Number.isInteger(input.maxUses) || input.maxUses < 1)) ||
    (input.startsAt && input.endsAt && input.startsAt >= input.endsAt)
  )
    throw new Error("Coupon configuration is invalid.");
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO coupons
         (tenant_id,code,discount_type,discount_value,currency,max_uses,starts_at,ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        scope.tenant.tenantId,
        code,
        input.discountType,
        input.discountValue.toString(),
        input.currency,
        input.maxUses,
        input.startsAt,
        input.endsAt,
      ],
    );
    const couponId = inserted.rows[0]?.id;
    if (!couponId) throw new Error("Coupon creation failed.");
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,$2,'coupon.created','COUPON',$3,$4,$5::jsonb)`,
      [
        scope.tenant.tenantId,
        scope.actor.id,
        couponId,
        scope.requestId,
        JSON.stringify({
          code,
          discountType: input.discountType,
          discountValue: input.discountValue.toString(),
          currency: input.currency,
          maxUses: input.maxUses,
        }),
      ],
    );
    await client.query("COMMIT");
    return { id: couponId, code };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function applyCoupon(
  scope: Scope,
  enrollmentId: string,
  codeInput: string,
) {
  if (
    scope.actor.tenantId !== scope.tenant.tenantId ||
    !scope.tenant.features.payments
  )
    throw new Error("Coupons are unavailable.");
  const code = codeInput.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,64}$/.test(code)) throw new Error("Coupon is invalid.");
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const payments = await client.query<{
      id: string;
      original_amount: string;
      currency: string;
      coupon_id: string | null;
      state: string;
      status: string;
      payment_expires_at: Date | null;
    }>(
      `SELECT p.id,p.original_amount,p.currency,p.coupon_id,p.state,
         e.status,e.payment_expires_at
       FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
       WHERE p.tenant_id=$1 AND p.enrollment_id=$2 AND p.participant_id=$3
       FOR UPDATE OF p,e`,
      [scope.tenant.tenantId, enrollmentId, scope.actor.id],
    );
    const payment = payments.rows[0];
    if (
      payment?.state !== "CREATED" ||
      payment.status !== "AWAITING_PAYMENT" ||
      !payment.payment_expires_at ||
      payment.payment_expires_at <= new Date() ||
      payment.coupon_id
    )
      throw new Error("Coupon cannot be applied to this enrollment.");
    const attempts = await client.query(
      "SELECT 1 FROM payment_attempts WHERE tenant_id=$1 AND payment_id=$2 LIMIT 1",
      [scope.tenant.tenantId, payment.id],
    );
    if (attempts.rowCount)
      throw new Error("Coupon cannot be changed after checkout begins.");
    const coupons = await client.query<{
      id: string;
      discount_type: "FIXED" | "PERCENT";
      discount_value: string;
      currency: string;
      max_uses: number | null;
      used_count: number;
      starts_at: Date | null;
      ends_at: Date | null;
      enabled: boolean;
    }>("SELECT * FROM coupons WHERE tenant_id=$1 AND code=$2 FOR UPDATE", [
      scope.tenant.tenantId,
      code,
    ]);
    const coupon = coupons.rows[0];
    const now = new Date();
    if (
      !coupon?.enabled ||
      coupon.currency !== payment.currency ||
      (coupon.starts_at && coupon.starts_at > now) ||
      (coupon.ends_at && coupon.ends_at <= now)
    )
      throw new Error("Coupon is unavailable.");
    const reserved = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM coupon_reservations WHERE tenant_id=$1 AND coupon_id=$2 AND status='ACTIVE'",
      [scope.tenant.tenantId, coupon.id],
    );
    if (
      coupon.max_uses !== null &&
      coupon.used_count + (reserved.rows[0]?.count ?? 0) >= coupon.max_uses
    )
      throw new Error("Coupon usage limit has been reached.");
    const original = BigInt(payment.original_amount);
    const value = BigInt(coupon.discount_value);
    const discount =
      coupon.discount_type === "PERCENT"
        ? (original * value) / 10000n
        : value > original
          ? original
          : value;
    if (discount <= 0n)
      throw new Error("Coupon does not apply to this amount.");
    await client.query(
      `INSERT INTO coupon_reservations (tenant_id,payment_id,coupon_id,discount_amount)
       VALUES ($1,$2,$3,$4)`,
      [scope.tenant.tenantId, payment.id, coupon.id, discount.toString()],
    );
    await client.query(
      `UPDATE payments SET coupon_id=$3,discount_amount=$4,payable_amount=original_amount-$4,updated_at=now()
       WHERE tenant_id=$1 AND id=$2`,
      [scope.tenant.tenantId, payment.id, coupon.id, discount.toString()],
    );
    if (discount === original) {
      await client.query(
        "UPDATE coupon_reservations SET status='REDEEMED',updated_at=now() WHERE tenant_id=$1 AND payment_id=$2",
        [scope.tenant.tenantId, payment.id],
      );
      await client.query(
        "UPDATE coupons SET used_count=used_count+1 WHERE tenant_id=$1 AND id=$2",
        [scope.tenant.tenantId, coupon.id],
      );
      await client.query(
        "UPDATE payments SET state='SUCCEEDED',succeeded_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [scope.tenant.tenantId, payment.id],
      );
      await client.query(
        "UPDATE enrollments SET status='CONFIRMED',payment_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [scope.tenant.tenantId, enrollmentId],
      );
      await client.query(
        `INSERT INTO invoices (tenant_id,payment_id,enrollment_id,invoice_number,snapshot)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [
          scope.tenant.tenantId,
          payment.id,
          enrollmentId,
          `INV-${randomUUID()}`,
          JSON.stringify({
            originalAmount: original.toString(),
            discountAmount: discount.toString(),
            paidAmount: "0",
            currency: payment.currency,
            couponId: coupon.id,
            provider: null,
          }),
        ],
      );
    }
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,$2,'coupon.applied','PAYMENT',$3,$4,$5::jsonb)`,
      [
        scope.tenant.tenantId,
        scope.actor.id,
        payment.id,
        scope.requestId,
        JSON.stringify({
          couponId: coupon.id,
          discountAmount: discount.toString(),
        }),
      ],
    );
    await client.query("COMMIT");
    return {
      discountAmount: discount.toString(),
      payableAmount: (original - discount).toString(),
      currency: payment.currency,
      status: discount === original ? "CONFIRMED" : "AWAITING_PAYMENT",
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
