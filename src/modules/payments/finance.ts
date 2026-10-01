import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";

type Scope = Readonly<{ tenant: TenantContext; actor: TenantActor }>;

function financeScope(scope: Scope): void {
  if (
    scope.tenant.tenantId !== scope.actor.tenantId ||
    !scope.tenant.features.payments
  )
    throw new DomainError("FORBIDDEN", "Finance is unavailable.");
  authorize(scope.actor.permissions, "finance.read");
}

export type FinanceFilters = Readonly<{
  status?: string | undefined;
  runId?: string | undefined;
  provider?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}>;

function checkedFilters(filters: FinanceFilters) {
  const status = filters.status || null;
  const runId = filters.runId || null;
  const provider = filters.provider || null;
  const from = filters.from || null;
  const to = filters.to || null;
  if (
    (status && !/^[A-Z_]{2,20}$/.test(status)) ||
    (runId && !/^[0-9a-f-]{36}$/i.test(runId)) ||
    (provider && !/^[A-Z][A-Z0-9_]{1,39}$/.test(provider)) ||
    (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) ||
    (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))
  )
    throw new DomainError("VALIDATION_FAILED", "Invalid finance filter.");
  return [status, runId, provider, from, to] as const;
}

export async function getFinanceOverview(scope: Scope) {
  financeScope(scope);
  const result = await getTenantPool(scope.tenant).query<{
    successful: number;
    pending: number;
    failed: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE state IN ('SUCCEEDED','REFUND_PENDING','REFUNDED'))::int AS successful,
       count(*) FILTER (WHERE state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING'))::int AS pending,
       count(*) FILTER (WHERE state IN ('FAILED','EXPIRED','CANCELLED'))::int AS failed
     FROM payments WHERE tenant_id=$1`,
    [scope.tenant.tenantId],
  );
  const gross = await getTenantPool(scope.tenant).query<{
    currency: string;
    amount: string;
  }>(
    "SELECT currency,sum(paid_amount)::text AS amount FROM payments WHERE tenant_id=$1 AND paid_amount>0 GROUP BY currency ORDER BY currency",
    [scope.tenant.tenantId],
  );
  const refunded = await getTenantPool(scope.tenant).query<{
    currency: string;
    amount: string;
  }>(
    "SELECT currency,sum(amount)::text AS amount FROM refunds WHERE tenant_id=$1 AND status='SUCCEEDED' GROUP BY currency ORDER BY currency",
    [scope.tenant.tenantId],
  );
  return { ...result.rows[0], gross: gross.rows, refunded: refunded.rows };
}

export async function listFinanceTransactions(
  scope: Scope,
  filters: FinanceFilters = {},
) {
  financeScope(scope);
  const checked = checkedFilters(filters);
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    enrollment_id: string;
    participant_name: string;
    participant_email: string;
    run_id: string;
    run_title: string;
    payable_amount: string;
    paid_amount: string;
    currency: string;
    state: string;
    provider_key: string | null;
    provider_reference_id: string | null;
    created_at: Date;
  }>(
    `SELECT p.id,p.enrollment_id,u.name AS participant_name,u.email AS participant_email,
       r.id AS run_id,r.title AS run_title,p.payable_amount,p.paid_amount,p.currency,p.state,
       latest.provider_key,latest.provider_reference_id,p.created_at
     FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
     JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     JOIN tenant_users u ON u."tenantId"=p.tenant_id AND u.id=p.participant_id
     LEFT JOIN LATERAL (
       SELECT provider_key,provider_reference_id FROM payment_attempts a
       WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id
       ORDER BY attempt_number DESC LIMIT 1
     ) latest ON true
     WHERE p.tenant_id=$1 AND ($2::text IS NULL OR p.state=$2)
       AND ($3::uuid IS NULL OR r.id=$3)
       AND ($4::text IS NULL OR latest.provider_key=$4)
       AND ($5::date IS NULL OR p.created_at >= $5::date)
       AND ($6::date IS NULL OR p.created_at < $6::date + interval '1 day')
     ORDER BY p.created_at DESC,p.id DESC LIMIT 200`,
    [scope.tenant.tenantId, ...checked],
  );
  return result.rows;
}

export async function listFinanceInvoices(scope: Scope) {
  financeScope(scope);
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    invoice_number: string;
    participant_name: string;
    payment_id: string;
    paid_amount: string;
    currency: string;
    payment_state: string;
    issued_at: Date;
  }>(
    `SELECT i.id,i.invoice_number,u.name AS participant_name,i.payment_id,
       p.paid_amount,p.currency,p.state AS payment_state,i.issued_at
     FROM invoices i JOIN payments p ON p.tenant_id=i.tenant_id AND p.id=i.payment_id
     JOIN tenant_users u ON u."tenantId"=p.tenant_id AND u.id=p.participant_id
     WHERE i.tenant_id=$1 ORDER BY i.issued_at DESC LIMIT 200`,
    [scope.tenant.tenantId],
  );
  return result.rows;
}

export async function listFinanceRefunds(scope: Scope) {
  financeScope(scope);
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    payment_id: string;
    participant_name: string;
    method: string;
    status: string;
    amount: string;
    currency: string;
    reason: string;
    reference: string | null;
    created_at: Date;
  }>(
    `SELECT f.id,f.payment_id,u.name AS participant_name,f.method,f.status,
       f.amount,f.currency,f.reason,f.reference,f.created_at
     FROM refunds f JOIN payments p ON p.tenant_id=f.tenant_id AND p.id=f.payment_id
     JOIN tenant_users u ON u."tenantId"=p.tenant_id AND u.id=p.participant_id
     WHERE f.tenant_id=$1 ORDER BY f.created_at DESC LIMIT 200`,
    [scope.tenant.tenantId],
  );
  return result.rows;
}

export async function listFinanceCoupons(scope: Scope) {
  financeScope(scope);
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    code: string;
    discount_type: string;
    discount_value: string;
    currency: string;
    max_uses: number | null;
    used_count: number;
    reserved_count: number;
    released_count: number;
    enabled: boolean;
  }>(
    `SELECT c.id,c.code,c.discount_type,c.discount_value,c.currency,c.max_uses,
       c.used_count,c.enabled,
       count(cr.payment_id) FILTER (WHERE cr.status='ACTIVE')::int AS reserved_count,
       count(cr.payment_id) FILTER (WHERE cr.status='RELEASED')::int AS released_count
     FROM coupons c LEFT JOIN coupon_reservations cr
       ON cr.tenant_id=c.tenant_id AND cr.coupon_id=c.id
     WHERE c.tenant_id=$1 GROUP BY c.tenant_id,c.id ORDER BY c.created_at DESC LIMIT 200`,
    [scope.tenant.tenantId],
  );
  return result.rows;
}

export async function listOwnPayments(scope: Scope) {
  if (
    scope.tenant.tenantId !== scope.actor.tenantId ||
    !scope.tenant.features.payments
  )
    throw new DomainError("FORBIDDEN", "Payments are unavailable.");
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    enrollment_id: string;
    run_title: string;
    payable_amount: string;
    paid_amount: string;
    currency: string;
    state: string;
    enrollment_status: string;
    created_at: Date;
  }>(
    `SELECT p.id,p.enrollment_id,r.title AS run_title,p.payable_amount,p.paid_amount,
       p.currency,p.state,e.status AS enrollment_status,p.created_at
     FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
     JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     WHERE p.tenant_id=$1 AND p.participant_id=$2
     ORDER BY p.created_at DESC LIMIT 100`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  return result.rows;
}

export async function getOwnPayment(scope: Scope, paymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId))
    throw new DomainError("NOT_FOUND", "Payment not found.");
  if (
    scope.tenant.tenantId !== scope.actor.tenantId ||
    !scope.tenant.features.payments
  )
    throw new DomainError("FORBIDDEN", "Payments are unavailable.");
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    enrollment_id: string;
    run_title: string;
    payable_amount: string;
    paid_amount: string;
    currency: string;
    state: string;
    enrollment_status: string;
    created_at: Date;
  }>(
    `SELECT p.id,p.enrollment_id,r.title AS run_title,p.payable_amount,p.paid_amount,
       p.currency,p.state,e.status AS enrollment_status,p.created_at
     FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
     JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     WHERE p.tenant_id=$1 AND p.id=$2 AND p.participant_id=$3`,
    [scope.tenant.tenantId, paymentId, scope.actor.id],
  );
  const payment = result.rows[0];
  if (!payment) throw new DomainError("NOT_FOUND", "Payment not found.");
  return payment;
}

export async function listOwnInvoices(scope: Scope) {
  if (
    scope.tenant.tenantId !== scope.actor.tenantId ||
    !scope.tenant.features.payments
  )
    throw new DomainError("FORBIDDEN", "Invoices are unavailable.");
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    payment_id: string;
    invoice_number: string;
    snapshot: Record<string, unknown>;
    issued_at: Date;
  }>(
    `SELECT i.id,i.payment_id,i.invoice_number,i.snapshot,i.issued_at
     FROM invoices i JOIN payments p ON p.tenant_id=i.tenant_id AND p.id=i.payment_id
     WHERE i.tenant_id=$1 AND p.participant_id=$2
     ORDER BY i.issued_at DESC LIMIT 100`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  return result.rows;
}

export async function getInvoiceForDownload(scope: Scope, invoiceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId))
    throw new DomainError("NOT_FOUND", "Invoice not found.");
  if (
    scope.tenant.tenantId !== scope.actor.tenantId ||
    !scope.tenant.features.payments
  )
    throw new DomainError("FORBIDDEN", "Invoices are unavailable.");
  const allowed = scope.actor.permissions.has("finance.read");
  const result = await getTenantPool(scope.tenant).query<{
    invoice_number: string;
    snapshot: Record<string, unknown>;
    issued_at: Date;
    participant_name: string;
    run_title: string;
  }>(
    `SELECT i.invoice_number,i.snapshot,i.issued_at,u.name AS participant_name,
       r.title AS run_title
     FROM invoices i JOIN payments p ON p.tenant_id=i.tenant_id AND p.id=i.payment_id
     JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
     JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     JOIN tenant_users u ON u."tenantId"=p.tenant_id AND u.id=p.participant_id
     WHERE i.tenant_id=$1 AND i.id=$2
       AND ($3::boolean OR p.participant_id=$4)`,
    [scope.tenant.tenantId, invoiceId, allowed, scope.actor.id],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Invoice not found.");
  return result.rows[0];
}
