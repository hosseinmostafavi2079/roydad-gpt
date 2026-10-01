import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { decryptProviderConfig } from "./configuration";
import { requestProviderRefund } from "./operations";
import { resolvePaymentProvider } from "./registry";

type RefundScope = Readonly<{
  tenant: TenantContext;
  actor: TenantActor;
  requestId: string;
}>;

export async function refundPayment(
  scope: RefundScope,
  input: Readonly<{
    paymentId: string;
    amount: bigint;
    method: "PROVIDER" | "MANUAL";
    reason: string;
    reference?: string;
  }>,
) {
  const { tenant, actor } = scope;
  if (actor.tenantId !== tenant.tenantId || !tenant.features.payments)
    throw new Error("Refund is unavailable.");
  authorize(actor.permissions, "refund.manage");
  const reason = input.reason.trim();
  const reference = input.reference?.trim();
  if (
    !reason ||
    reason.length > 500 ||
    (input.method === "MANUAL" && (!reference || reference.length > 255))
  )
    throw new Error("A valid reason and manual reference are required.");
  const client = await getTenantPool(tenant).connect();
  let refundId: string;
  let payment: {
    id: string;
    enrollment_id: string;
    paid_amount: string;
    currency: string;
  };
  let attempt: {
    id: string;
    provider_key: string;
    encrypted_config: Buffer;
    provider_transaction_id: string | null;
  };
  try {
    await client.query("BEGIN");
    const payments = await client.query<typeof payment>(
      `SELECT id,enrollment_id,paid_amount,currency FROM payments
       WHERE tenant_id=$1 AND id=$2 AND state IN ('SUCCEEDED','REFUND_PENDING') FOR UPDATE`,
      [tenant.tenantId, input.paymentId],
    );
    if (!payments.rows[0]) throw new Error("Payment is not refundable.");
    payment = payments.rows[0];
    const attempts = await client.query<typeof attempt>(
      `SELECT id,provider_key,encrypted_config,provider_transaction_id
       FROM payment_attempts WHERE tenant_id=$1 AND payment_id=$2 AND state='SUCCEEDED'
       ORDER BY attempt_number DESC LIMIT 1`,
      [tenant.tenantId, input.paymentId],
    );
    if (!attempts.rows[0])
      throw new Error("Verified payment attempt was not found.");
    attempt = attempts.rows[0];
    const provider = resolvePaymentProvider(attempt.provider_key);
    if (input.method === "MANUAL" && provider.capabilities.supportsRefund)
      throw new Error("Use the provider refund API for this payment.");
    if (input.method === "PROVIDER" && !provider.capabilities.supportsRefund)
      throw new Error("Provider API refund is unavailable.");
    const total = await client.query<{ amount: string }>(
      `SELECT coalesce(sum(amount),0)::text AS amount FROM refunds
       WHERE tenant_id=$1 AND payment_id=$2 AND status IN ('PENDING','SUCCEEDED')`,
      [tenant.tenantId, input.paymentId],
    );
    if (
      input.amount <= 0n ||
      input.amount + BigInt(total.rows[0]?.amount ?? "0") >
        BigInt(payment.paid_amount)
    )
      throw new Error("Refund exceeds the paid amount.");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO refunds (tenant_id,payment_id,payment_attempt_id,method,status,amount,currency,reason,reference,actor_id,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        tenant.tenantId,
        input.paymentId,
        attempt.id,
        input.method,
        input.method === "MANUAL" ? "SUCCEEDED" : "PENDING",
        input.amount.toString(),
        payment.currency,
        reason,
        reference ?? null,
        actor.id,
        input.method === "MANUAL" ? new Date() : null,
      ],
    );
    if (!inserted.rows[0]) throw new Error("Refund creation failed.");
    refundId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,$2,'payment.refund_requested','REFUND',$3,$4,$5::jsonb)`,
      [
        tenant.tenantId,
        actor.id,
        refundId,
        scope.requestId,
        JSON.stringify({
          method: input.method,
          amount: input.amount.toString(),
          currency: payment.currency,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (input.method === "PROVIDER") {
    try {
      const provider = resolvePaymentProvider(attempt.provider_key);
      const config = decryptProviderConfig(
        tenant.tenantId,
        attempt.provider_key,
        attempt.encrypted_config,
      );
      const result = await requestProviderRefund(provider, {
        paymentId: payment.id,
        paymentAttemptId: attempt.id,
        refundId,
        amount: BigInt(payment.paid_amount),
        currency: payment.currency,
        refundAmount: input.amount,
        providerTransactionId: attempt.provider_transaction_id,
        reason,
        config,
      });
      await getTenantPool(tenant).query(
        `UPDATE refunds SET status=$3::varchar(16), reference=$4,
           completed_at=CASE WHEN $3::varchar(16)='SUCCEEDED' THEN now() ELSE NULL END
         WHERE tenant_id=$1 AND id=$2 AND status='PENDING'`,
        [
          tenant.tenantId,
          refundId,
          result.state === "REFUNDED" ? "SUCCEEDED" : "PENDING",
          result.reference,
        ],
      );
    } catch (error) {
      await finalizeRefundState(tenant, payment.id, scope.requestId);
      throw error;
    }
  }
  await finalizeRefundState(tenant, payment.id, scope.requestId);
  return { refundId, method: input.method };
}

async function finalizeRefundState(
  tenant: TenantContext,
  paymentId: string,
  requestId: string,
) {
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const payment = await client.query<{
      enrollment_id: string;
      paid_amount: string;
    }>(
      "SELECT enrollment_id,paid_amount FROM payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [tenant.tenantId, paymentId],
    );
    if (!payment.rows[0]) throw new Error("Payment was not found.");
    const totals = await client.query<{ refunded: string; pending: string }>(
      `SELECT coalesce(sum(amount) FILTER (WHERE status='SUCCEEDED'),0)::text AS refunded,
         coalesce(sum(amount) FILTER (WHERE status='PENDING'),0)::text AS pending
       FROM refunds WHERE tenant_id=$1 AND payment_id=$2`,
      [tenant.tenantId, paymentId],
    );
    const refunded = BigInt(totals.rows[0]?.refunded ?? "0");
    const pending = BigInt(totals.rows[0]?.pending ?? "0");
    const fullyRefunded = refunded === BigInt(payment.rows[0].paid_amount);
    const state = fullyRefunded
      ? "REFUNDED"
      : pending > 0n
        ? "REFUND_PENDING"
        : "SUCCEEDED";
    await client.query(
      "UPDATE payments SET state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [tenant.tenantId, paymentId, state],
    );
    if (fullyRefunded)
      await client.query(
        "UPDATE enrollments SET status='REFUNDED',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='CONFIRMED'",
        [tenant.tenantId, payment.rows[0].enrollment_id],
      );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,NULL,'payment.refund_state','PAYMENT',$2,$3,$4::jsonb)`,
      [
        tenant.tenantId,
        paymentId,
        requestId,
        JSON.stringify({ state, refundedAmount: refunded.toString() }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
