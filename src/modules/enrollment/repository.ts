import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import { validateAnswers } from "./form";

type Scope = Readonly<{
  tenant: TenantContext;
  actor: TenantActor;
  requestId: string;
}>;

export async function enrollParticipant(
  scope: Scope,
  runId: string,
  submittedAnswers: unknown,
) {
  return createEnrollment(scope, runId, scope.actor.id, submittedAnswers);
}

async function createEnrollment(
  scope: Scope,
  runId: string,
  participantId: string,
  submittedAnswers: unknown,
) {
  const { tenant, actor } = scope;
  if (actor.tenantId !== tenant.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  if (!tenant.features.registration)
    throw new DomainError("FEATURE_DISABLED", "Registration is unavailable.");
  if (!tenant.features.courses && !tenant.features.events)
    throw new DomainError("FEATURE_DISABLED", "Programs are unavailable.");
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      capacity: number;
      waitlist_enabled: boolean;
      registration_starts_at: Date | null;
      registration_ends_at: Date | null;
      ends_at: Date;
      registration_form_schema: unknown;
      price_amount: string;
      price_currency: string;
    }>(
      `SELECT r.id, r.capacity, r.waitlist_enabled, r.registration_starts_at,
       r.registration_ends_at, r.ends_at, r.registration_form_schema,
       r.price_amount, r.price_currency
       FROM program_runs r JOIN programs p ON p.tenant_id=r.tenant_id AND p.id=r.program_id
       WHERE r.tenant_id=$1 AND r.id=$2 AND r.state='PUBLISHED' AND p.status='ACTIVE'
       FOR UPDATE OF r`,
      [tenant.tenantId, runId],
    );
    const run = result.rows[0];
    if (!run) throw new DomainError("NOT_FOUND", "Program is unavailable.");
    const now = new Date();
    if (
      run.ends_at <= now ||
      (run.registration_starts_at && run.registration_starts_at > now) ||
      (run.registration_ends_at && run.registration_ends_at <= now)
    )
      throw new DomainError(
        "REGISTRATION_CLOSED",
        "ثبت‌نام این برنامه باز نیست.",
      );
    const participant = await client.query(
      `SELECT 1 FROM tenant_participant_profiles WHERE tenant_id=$1 AND user_id=$2`,
      [tenant.tenantId, participantId],
    );
    if (!participant.rowCount)
      throw new DomainError("FORBIDDEN", "Only participants can register.");
    const existing = await client.query(
      `SELECT 1 FROM enrollments WHERE tenant_id=$1 AND run_id=$2 AND participant_id=$3`,
      [tenant.tenantId, runId, participantId],
    );
    if (existing.rowCount)
      throw new DomainError(
        "ALREADY_ENROLLED",
        "شما پیش‌تر برای این برنامه ثبت‌نام کرده‌اید.",
      );
    const { form, answers } = validateAnswers(
      run.registration_form_schema,
      submittedAnswers,
    );
    const price = BigInt(run.price_amount);
    if (price > 0n && !tenant.features.payments)
      throw new DomainError("FEATURE_DISABLED", "Payments are unavailable.");
    const confirmed = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM enrollments WHERE tenant_id=$1 AND run_id=$2
       AND (status='CONFIRMED' OR (status='AWAITING_PAYMENT' AND payment_expires_at > now()))`,
      [tenant.tenantId, runId],
    );
    const hasCapacity = (confirmed.rows[0]?.count ?? 0) < run.capacity;
    if (!hasCapacity && !(run.waitlist_enabled && tenant.features.waitlist))
      throw new DomainError(
        "CAPACITY_REACHED",
        "ظرفیت این برنامه تکمیل شده است.",
      );
    const status = hasCapacity
      ? price > 0n
        ? "AWAITING_PAYMENT"
        : "CONFIRMED"
      : "WAITLISTED";
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO enrollments (tenant_id,run_id,participant_id,status,answers,form_schema_snapshot,payment_expires_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id`,
      [
        tenant.tenantId,
        runId,
        participantId,
        status,
        JSON.stringify(answers),
        JSON.stringify(form),
        status === "AWAITING_PAYMENT"
          ? new Date(Date.now() + 15 * 60_000)
          : null,
      ],
    );
    if (status === "AWAITING_PAYMENT") {
      await client.query(
        `INSERT INTO payments
           (tenant_id,enrollment_id,participant_id,original_amount,payable_amount,currency,idempotency_key)
         VALUES ($1,$2,$3,$4,$4,$5,$6)`,
        [
          tenant.tenantId,
          inserted.rows[0]?.id,
          participantId,
          price.toString(),
          run.price_currency,
          `enrollment:${inserted.rows[0]?.id}`,
        ],
      );
    }
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,$2,'enrollment.created','ENROLLMENT',$3,$4,$5::jsonb)`,
      [
        tenant.tenantId,
        actor.id,
        inserted.rows[0]?.id,
        scope.requestId,
        JSON.stringify({ status }),
      ],
    );
    await client.query("COMMIT");
    return {
      id: inserted.rows[0]?.id,
      status,
      ...(status === "AWAITING_PAYMENT"
        ? {
            paymentSummary: {
              originalAmount: price.toString(),
              discountAmount: "0",
              payableAmount: price.toString(),
              currency: run.price_currency,
            },
          }
        : {}),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23505"
    )
      throw new DomainError(
        "ALREADY_ENROLLED",
        "شما پیش‌تر برای این برنامه ثبت‌نام کرده‌اید.",
      );
    throw error;
  } finally {
    client.release();
  }
}

export async function enrollForParticipant(
  scope: Scope,
  runId: string,
  participantEmail: string,
  answers: unknown,
) {
  if (scope.tenant.tenantId !== scope.actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(scope.actor.permissions, "enrollment.manage");
  const result = await getTenantPool(scope.tenant).query<{ id: string }>(
    `SELECT u.id FROM tenant_users u JOIN tenant_participant_profiles p
     ON p.tenant_id=u."tenantId" AND p.user_id=u.id
     WHERE u."tenantId"=$1 AND u.email=$2 AND u.status='ACTIVE'`,
    [scope.tenant.tenantId, participantEmail.trim().toLowerCase()],
  );
  if (!result.rows[0])
    throw new DomainError("NOT_FOUND", "Participant not found.");
  return createEnrollment(scope, runId, result.rows[0].id, answers);
}

export async function cancelManagedEnrollment(
  scope: Scope,
  enrollmentId: string,
) {
  if (scope.tenant.tenantId !== scope.actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(scope.actor.permissions, "enrollment.manage");
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ status: string }>(
      "SELECT status FROM enrollments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, enrollmentId],
    );
    if (!current.rows[0])
      throw new DomainError("NOT_FOUND", "Enrollment not found.");
    if (!["CONFIRMED", "WAITLISTED"].includes(current.rows[0].status))
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "This enrollment cannot be cancelled.",
      );
    await client.query(
      "UPDATE enrollments SET status='CANCELLED',updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [scope.tenant.tenantId, enrollmentId],
    );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,$2,'enrollment.cancelled','ENROLLMENT',$3,$4,'{"status":"CANCELLED"}'::jsonb)`,
      [scope.tenant.tenantId, scope.actor.id, enrollmentId, scope.requestId],
    );
    await client.query("COMMIT");
    return { id: enrollmentId, status: "CANCELLED" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listOwnEnrollments(scope: Scope) {
  if (scope.tenant.tenantId !== scope.actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT e.id, e.status, e.registered_at, r.id AS run_id, r.title, r.starts_at, r.ends_at,
      r.delivery_mode, p.slug AS program_slug
     FROM enrollments e JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     JOIN programs p ON p.tenant_id=r.tenant_id AND p.id=r.program_id
     WHERE e.tenant_id=$1 AND e.participant_id=$2 ORDER BY r.starts_at DESC LIMIT 100`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  return result.rows;
}

export async function listManagedEnrollments(scope: Scope, runId?: string) {
  if (scope.tenant.tenantId !== scope.actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(scope.actor.permissions, "enrollment.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT e.id, e.status, e.registered_at, e.answers, u.name, u.email,
      r.title AS run_title, r.id AS run_id
     FROM enrollments e JOIN tenant_users u ON u."tenantId"=e.tenant_id AND u.id=e.participant_id
     JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.run_id=$2::uuid)
     ORDER BY e.registered_at DESC LIMIT 500`,
    [scope.tenant.tenantId, runId || null],
  );
  return result.rows;
}
