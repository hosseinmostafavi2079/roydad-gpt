SET ROLE eventos_tenant_owner;

ALTER TABLE enrollments DROP CONSTRAINT enrollments_status_check;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('PENDING','AWAITING_PAYMENT','CONFIRMED','WAITLISTED','CANCELLED','REFUNDED','COMPLETED','EXPIRED'));

ALTER TABLE payment_attempts
  ADD COLUMN reconcile_failures integer NOT NULL DEFAULT 0 CHECK (reconcile_failures >= 0),
  ADD COLUMN next_reconcile_at timestamptz;

CREATE INDEX enrollments_payment_expiry_idx ON enrollments (tenant_id, payment_expires_at)
  WHERE status='AWAITING_PAYMENT';
CREATE INDEX payment_attempts_next_reconcile_idx ON payment_attempts (tenant_id, next_reconcile_at)
  WHERE state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING');

RESET ROLE;
