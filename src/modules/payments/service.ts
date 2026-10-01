import "server-only";

import { randomUUID } from "node:crypto";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { logger } from "@/infrastructure/logging/logger";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import {
  decryptProviderConfig,
  encryptProviderConfig,
  loadActiveProviderConfiguration,
} from "./configuration";
import {
  createProviderAttempt,
  queryProviderAttempt,
  verifyProviderAttempt,
} from "./operations";
import { resolvePaymentProvider } from "./registry";
import type {
  PaymentIdentity,
  ProviderPaymentResult,
  ProviderVerificationResult,
} from "./provider";
import { assertVerifiedPayment } from "./provider";

type PaymentRow = {
  id: string;
  enrollment_id: string;
  participant_id: string;
  original_amount: string;
  discount_amount: string;
  coupon_id: string | null;
  payable_amount: string;
  currency: string;
  state: string;
};

type AttemptRow = {
  id: string;
  payment_id: string;
  provider_key: string;
  encrypted_config: Buffer;
  provider_authority: string | null;
  provider_transaction_id: string | null;
  state: string;
};

function identity(payment: PaymentRow, attemptId: string): PaymentIdentity {
  return {
    paymentId: payment.id,
    paymentAttemptId: attemptId,
    amount: BigInt(payment.payable_amount),
    currency: payment.currency,
  };
}

export async function startPaymentAttempt(input: {
  tenant: TenantContext;
  actor: TenantActor;
  enrollmentId: string;
  providerKey: string;
  callbackUrl: string;
  requestId: string;
}) {
  const { tenant, actor, enrollmentId, providerKey } = input;
  if (actor.tenantId !== tenant.tenantId || !tenant.features.payments)
    throw new Error("Payment is unavailable.");
  const provider = resolvePaymentProvider(providerKey);
  const config = await loadActiveProviderConfiguration(tenant, providerKey);
  const client = await getTenantPool(tenant).connect();
  let payment: PaymentRow;
  let attemptId: string;
  try {
    await client.query("BEGIN");
    const found = await client.query<
      PaymentRow & {
        enrollment_status: string;
        payment_expires_at: Date | null;
      }
    >(
      `SELECT p.*, e.status AS enrollment_status, e.payment_expires_at
       FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
       WHERE p.tenant_id=$1 AND p.enrollment_id=$2 AND p.participant_id=$3
       FOR UPDATE OF p, e`,
      [tenant.tenantId, enrollmentId, actor.id],
    );
    const row = found.rows[0];
    if (
      row?.enrollment_status !== "AWAITING_PAYMENT" ||
      !row.payment_expires_at ||
      row.payment_expires_at <= new Date() ||
      ["SUCCEEDED", "REFUND_PENDING", "REFUNDED"].includes(row.state)
    )
      throw new Error("Enrollment is not payable.");
    const active = await client.query(
      `SELECT 1 FROM payment_attempts WHERE tenant_id=$1 AND payment_id=$2
       AND state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING') LIMIT 1`,
      [tenant.tenantId, row.id],
    );
    if (active.rowCount)
      throw new Error("A payment attempt is already active.");
    const sequence = await client.query<{ next_number: number }>(
      "SELECT coalesce(max(attempt_number),0)+1 AS next_number FROM payment_attempts WHERE tenant_id=$1 AND payment_id=$2",
      [tenant.tenantId, row.id],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO payment_attempts (tenant_id,payment_id,attempt_number,provider_key,encrypted_config)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        tenant.tenantId,
        row.id,
        sequence.rows[0]?.next_number ?? 1,
        providerKey,
        encryptProviderConfig(tenant.tenantId, providerKey, config),
      ],
    );
    if (!inserted.rows[0]) throw new Error("Payment attempt creation failed.");
    attemptId = inserted.rows[0].id;
    payment = row;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  let created: ProviderPaymentResult;
  try {
    created = await createProviderAttempt(provider, {
      ...identity(payment, attemptId),
      callbackUrl: input.callbackUrl,
      config,
    });
  } catch (error) {
    await getTenantPool(tenant).query(
      `UPDATE payment_attempts SET state='VERIFYING', failure_code='PROVIDER_CREATE_UNKNOWN',
         last_checked_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND state='CREATED'`,
      [tenant.tenantId, attemptId],
    );
    await getTenantPool(tenant).query(
      `UPDATE payments SET state='VERIFYING', updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND state='CREATED'`,
      [tenant.tenantId, payment.id],
    );
    throw error;
  }
  const updateClient = await getTenantPool(tenant).connect();
  try {
    await updateClient.query("BEGIN");
    await updateClient.query(
      `UPDATE payment_attempts SET state=$3, provider_authority=$4, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND state='CREATED'`,
      [
        tenant.tenantId,
        attemptId,
        created.state,
        created.providerAuthority ?? null,
      ],
    );
    await updateClient.query(
      `UPDATE payments SET state=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2
       AND state IN ('CREATED','FAILED','EXPIRED')`,
      [tenant.tenantId, payment.id, created.state],
    );
    await updateClient.query("COMMIT");
    return {
      paymentId: payment.id,
      paymentAttemptId: attemptId,
      state: created.state,
      redirectUrl: created.redirectUrl ?? null,
    };
  } catch (error) {
    await updateClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    updateClient.release();
  }
}

export async function verifyPaymentAttempt(input: {
  tenant: TenantContext;
  attemptId: string;
  expectedProviderKey: string;
  callback: Readonly<Record<string, string>>;
  requestId: string;
}) {
  const { tenant, attemptId, requestId } = input;
  const pool = getTenantPool(tenant);
  const found = await pool.query<AttemptRow & PaymentRow>(
    `SELECT a.id, a.payment_id, a.provider_key, a.encrypted_config, a.provider_authority,
       a.provider_transaction_id, a.state, p.enrollment_id, p.participant_id,
       p.original_amount, p.discount_amount, p.coupon_id, p.payable_amount, p.currency
     FROM payment_attempts a JOIN payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id
     WHERE a.tenant_id=$1 AND a.id=$2`,
    [tenant.tenantId, attemptId],
  );
  const row = found.rows[0];
  if (!row) throw new Error("Payment attempt was not found.");
  if (row.provider_key !== input.expectedProviderKey)
    throw new Error("Payment provider mismatch.");
  if (row.state === "SUCCEEDED")
    return { state: "SUCCEEDED" as const, paymentId: row.payment_id };
  if (
    !["CREATED", "PENDING", "REQUIRES_REDIRECT", "VERIFYING"].includes(
      row.state,
    )
  )
    throw new Error("Payment attempt is not verifiable.");
  const provider = resolvePaymentProvider(row.provider_key);
  const config = decryptProviderConfig(
    tenant.tenantId,
    row.provider_key,
    row.encrypted_config,
  );
  const verified = await verifyProviderAttempt(provider, {
    ...identity({ ...row, id: row.payment_id, state: row.state }, attemptId),
    providerAuthority: row.provider_authority,
    callback: input.callback,
    config,
  });
  return persistVerification(tenant, row, verified, requestId);
}

export async function locatePaymentAttemptForCallback(
  tenant: TenantContext,
  providerKey: string,
  callback: Readonly<Record<string, string>>,
): Promise<string> {
  const provider = resolvePaymentProvider(providerKey);
  const reference: Readonly<{
    paymentAttemptId?: string | undefined;
    providerAuthority?: string;
  }> = provider.identifyCallback?.(callback) ?? {
    paymentAttemptId: callback.attempt,
  };
  if (
    reference.paymentAttemptId &&
    /^[0-9a-f-]{36}$/i.test(reference.paymentAttemptId)
  )
    return reference.paymentAttemptId;
  if (
    reference.providerAuthority &&
    reference.providerAuthority.length <= 255
  ) {
    const result = await getTenantPool(tenant).query<{ id: string }>(
      `SELECT id FROM payment_attempts
       WHERE tenant_id=$1 AND provider_key=$2 AND provider_authority=$3`,
      [tenant.tenantId, providerKey, reference.providerAuthority],
    );
    if (result.rows[0]) return result.rows[0].id;
  }
  throw new Error("Payment attempt is invalid.");
}

async function persistVerification(
  tenant: TenantContext,
  row: AttemptRow & PaymentRow,
  verified: ProviderVerificationResult,
  requestId: string,
) {
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const attempt = await client.query<AttemptRow>(
      "SELECT * FROM payment_attempts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [tenant.tenantId, row.id],
    );
    const current = attempt.rows[0];
    if (!current) throw new Error("Payment attempt was not found.");
    if (current.state === "SUCCEEDED") {
      await client.query("COMMIT");
      return { state: "SUCCEEDED" as const, paymentId: row.payment_id };
    }
    if (
      !["CREATED", "PENDING", "REQUIRES_REDIRECT", "VERIFYING"].includes(
        current.state,
      )
    )
      throw new Error("Payment attempt is no longer verifiable.");
    const payment = await client.query<PaymentRow>(
      "SELECT * FROM payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [tenant.tenantId, row.payment_id],
    );
    const latest = payment.rows[0];
    if (!latest) throw new Error("Payment was not found.");
    if (
      verified.state === "SUCCEEDED" &&
      (verified.verifiedAmount !== BigInt(latest.payable_amount) ||
        verified.verifiedCurrency !== latest.currency)
    )
      throw new Error("Verified payment amount or currency mismatch.");
    await client.query(
      `UPDATE payment_attempts SET state=$3, provider_transaction_id=$4,
         provider_reference_id=$5, last_checked_at=now(), reconcile_failures=0,
         next_reconcile_at=NULL, updated_at=now()
       WHERE tenant_id=$1 AND id=$2`,
      [
        tenant.tenantId,
        row.id,
        verified.state,
        verified.providerTransactionId ?? null,
        verified.providerReferenceId ?? null,
      ],
    );
    await client.query(
      `UPDATE payments SET state=$3::varchar(20), paid_amount=$4,
         succeeded_at=CASE WHEN $3::varchar(20)='SUCCEEDED' THEN now() ELSE succeeded_at END,
         updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [
        tenant.tenantId,
        row.payment_id,
        verified.state,
        verified.state === "SUCCEEDED" ? latest.payable_amount : "0",
      ],
    );
    if (verified.state === "SUCCEEDED") {
      const enrollment = await client.query<{
        status: string;
        payment_expires_at: Date | null;
      }>(
        "SELECT status,payment_expires_at FROM enrollments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tenant.tenantId, latest.enrollment_id],
      );
      const currentEnrollment = enrollment.rows[0];
      const reservationLive =
        currentEnrollment?.status === "AWAITING_PAYMENT" &&
        currentEnrollment.payment_expires_at !== null &&
        currentEnrollment.payment_expires_at > new Date();
      if (latest.coupon_id) {
        const reserved = await client.query<{ status: string }>(
          "SELECT status FROM coupon_reservations WHERE tenant_id=$1 AND payment_id=$2 FOR UPDATE",
          [tenant.tenantId, row.payment_id],
        );
        if (!reserved.rows[0])
          throw new Error("Coupon reservation is unavailable.");
        if (reservationLive && reserved.rows[0].status === "ACTIVE") {
          await client.query(
            "UPDATE coupons SET used_count=used_count+1 WHERE tenant_id=$1 AND id=$2",
            [tenant.tenantId, latest.coupon_id],
          );
          await client.query(
            "UPDATE coupon_reservations SET status='REDEEMED',updated_at=now() WHERE tenant_id=$1 AND payment_id=$2",
            [tenant.tenantId, row.payment_id],
          );
        } else if (!reservationLive && reserved.rows[0].status === "ACTIVE") {
          await client.query(
            "UPDATE coupon_reservations SET status='RELEASED',updated_at=now() WHERE tenant_id=$1 AND payment_id=$2",
            [tenant.tenantId, row.payment_id],
          );
        }
      }
      if (reservationLive) {
        await client.query(
          "UPDATE enrollments SET status='CONFIRMED', payment_expires_at=NULL, updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tenant.tenantId, latest.enrollment_id],
        );
      }
      await client.query(
        `INSERT INTO invoices (tenant_id,payment_id,enrollment_id,invoice_number,snapshot)
         VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (tenant_id,payment_id) DO NOTHING`,
        [
          tenant.tenantId,
          row.payment_id,
          latest.enrollment_id,
          `INV-${randomUUID()}`,
          JSON.stringify({
            originalAmount: latest.original_amount,
            discountAmount: latest.discount_amount,
            couponId: latest.coupon_id,
            paidAmount: latest.payable_amount,
            currency: latest.currency,
            provider: row.provider_key,
            providerTransactionId: verified.providerTransactionId ?? null,
            providerReferenceId: verified.providerReferenceId ?? null,
            lateAfterExpiry: !reservationLive,
          }),
        ],
      );
    }
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,NULL,'payment.verified','PAYMENT',$2,$3,$4::jsonb)`,
      [
        tenant.tenantId,
        row.payment_id,
        requestId,
        JSON.stringify({ state: verified.state, attemptId: row.id }),
      ],
    );
    await client.query("COMMIT");
    return { state: verified.state, paymentId: row.payment_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileUnresolvedPayments(
  tenant: TenantContext,
  requestId: string,
  limit = 50,
  providerKey?: string,
): Promise<{ checked: number; updated: number; failed: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid reconciliation batch size.");
  const attempts = await getTenantPool(tenant).query<AttemptRow & PaymentRow>(
    `SELECT a.id, a.payment_id, a.provider_key, a.encrypted_config,
       a.provider_authority, a.provider_transaction_id, a.state,
       p.enrollment_id, p.participant_id, p.original_amount,
       p.discount_amount, p.coupon_id, p.payable_amount, p.currency
     FROM payment_attempts a JOIN payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id
     WHERE a.tenant_id=$1 AND a.state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING')
       AND p.state NOT IN ('SUCCEEDED','REFUND_PENDING','REFUNDED')
       AND ($2::varchar IS NULL OR a.provider_key=$2)
       AND (a.next_reconcile_at IS NULL OR a.next_reconcile_at <= now())
     ORDER BY a.created_at LIMIT $3`,
    [tenant.tenantId, providerKey ?? null, limit],
  );
  let updated = 0;
  let failed = 0;
  for (const row of attempts.rows) {
    try {
      const provider = resolvePaymentProvider(row.provider_key);
      if (!provider.capabilities.supportsPaymentStatusQuery) continue;
      const config = decryptProviderConfig(
        tenant.tenantId,
        row.provider_key,
        row.encrypted_config,
      );
      const result = await queryProviderAttempt(provider, {
        ...identity({ ...row, id: row.payment_id, state: row.state }, row.id),
        providerAuthority: row.provider_authority,
        config,
      });
      if (result.state !== row.state || result.state === "SUCCEEDED") {
        await persistVerification(tenant, row, result, requestId);
      }
      if (
        ["CREATED", "PENDING", "REQUIRES_REDIRECT", "VERIFYING"].includes(
          result.state,
        )
      ) {
        await getTenantPool(tenant).query(
          `UPDATE payment_attempts SET last_checked_at=now(),reconcile_failures=0,
             next_reconcile_at=now()+interval '5 minutes'
           WHERE tenant_id=$1 AND id=$2 AND state=$3`,
          [tenant.tenantId, row.id, result.state],
        );
      }
      logger.info(
        {
          tenantId: tenant.tenantId,
          paymentId: row.payment_id,
          provider: row.provider_key,
          result: result.state,
          requestId,
        },
        "Payment reconciliation result",
      );
      updated += 1;
    } catch (error) {
      failed += 1;
      await getTenantPool(tenant).query(
        `UPDATE payment_attempts SET last_checked_at=now(),
           reconcile_failures=reconcile_failures+1,
           next_reconcile_at=now()+(least(3600,60*power(2,least(reconcile_failures+1,6)))::int * interval '1 second')
         WHERE tenant_id=$1 AND id=$2 AND state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING')`,
        [tenant.tenantId, row.id],
      );
      logger.warn(
        {
          tenantId: tenant.tenantId,
          paymentId: row.payment_id,
          provider: row.provider_key,
          result: "QUERY_FAILED",
          requestId,
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "Payment reconciliation deferred",
      );
    }
  }
  return { checked: attempts.rowCount ?? 0, updated, failed };
}

export async function processPaymentWebhook(input: {
  tenant: TenantContext;
  providerKey: string;
  headers: Headers;
  body: Uint8Array;
  requestId: string;
}) {
  const { tenant, providerKey, requestId } = input;
  const provider = resolvePaymentProvider(providerKey);
  if (
    !provider.capabilities.supportsWebhook ||
    !provider.verifyWebhook ||
    !provider.identifyWebhook
  )
    throw new Error("Provider webhooks are unavailable.");
  const locator = provider.identifyWebhook({
    headers: input.headers,
    body: input.body,
  });
  if (!locator.providerAuthority || locator.providerAuthority.length > 255)
    throw new Error("Payment webhook reference is invalid.");
  const pool = getTenantPool(tenant);
  const found = await pool.query<AttemptRow & PaymentRow>(
    `SELECT a.id,a.payment_id,a.provider_key,a.encrypted_config,a.provider_authority,
       a.provider_transaction_id,a.state,p.enrollment_id,p.participant_id,
       p.original_amount,p.discount_amount,p.coupon_id,p.payable_amount,p.currency
     FROM payment_attempts a JOIN payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id
     WHERE a.tenant_id=$1 AND a.provider_key=$2 AND a.provider_authority=$3`,
    [tenant.tenantId, providerKey, locator.providerAuthority],
  );
  const row = found.rows[0];
  if (!row) throw new Error("Payment attempt was not found.");
  const config = decryptProviderConfig(
    tenant.tenantId,
    providerKey,
    row.encrypted_config,
  );
  const event = await provider.verifyWebhook({
    config,
    headers: input.headers,
    body: input.body,
  });
  if (!event?.eventId || event.providerAuthority !== locator.providerAuthority)
    throw new Error("Payment webhook verification failed.");
  const prior = await pool.query(
    "SELECT 1 FROM payment_provider_events WHERE tenant_id=$1 AND provider_key=$2 AND event_id=$3",
    [tenant.tenantId, providerKey, event.eventId],
  );
  if (prior.rowCount) return { duplicate: true };
  assertVerifiedPayment(
    identity({ ...row, id: row.payment_id, state: row.state }, row.id),
    event.result,
  );
  const result = await persistVerification(
    tenant,
    row,
    event.result,
    requestId,
  );
  await pool.query(
    `INSERT INTO payment_provider_events (tenant_id,provider_key,event_id,payment_attempt_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [tenant.tenantId, providerKey, event.eventId, row.id],
  );
  return { duplicate: false, result };
}
