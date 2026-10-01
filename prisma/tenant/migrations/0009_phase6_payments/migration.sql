SET ROLE eventos_tenant_owner;

ALTER TABLE program_runs
  ADD COLUMN price_amount bigint NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  ADD COLUMN price_currency varchar(3) NOT NULL DEFAULT 'IRR' CHECK (price_currency ~ '^[A-Z]{3}$');

ALTER TABLE enrollments DROP CONSTRAINT enrollments_status_check;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('PENDING','AWAITING_PAYMENT','CONFIRMED','WAITLISTED','CANCELLED','REFUNDED','COMPLETED'));
ALTER TABLE enrollments ADD COLUMN payment_expires_at timestamptz;

CREATE TABLE payment_provider_configs (
  tenant_id uuid NOT NULL,
  provider_key varchar(40) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  encrypted_config bytea NOT NULL,
  updated_by varchar(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_key),
  FOREIGN KEY (tenant_id) REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, updated_by) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT
);

CREATE TABLE coupons (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL,
  discount_type varchar(12) NOT NULL CHECK (discount_type IN ('FIXED','PERCENT')),
  discount_value bigint NOT NULL CHECK (discount_value > 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (max_uses IS NULL OR used_count <= max_uses),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 10000),
  FOREIGN KEY (tenant_id) REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT
);

CREATE TABLE payments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL,
  participant_id varchar(64) NOT NULL,
  original_amount bigint NOT NULL CHECK (original_amount >= 0),
  discount_amount bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  payable_amount bigint NOT NULL CHECK (payable_amount >= 0),
  paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  coupon_id uuid,
  state varchar(20) NOT NULL DEFAULT 'CREATED' CHECK (state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING','SUCCEEDED','FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED')),
  idempotency_key varchar(128) NOT NULL,
  succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (original_amount = discount_amount + payable_amount),
  CHECK (paid_amount <= payable_amount),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES tenant_participant_profiles(tenant_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, coupon_id) REFERENCES coupons(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE payment_attempts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider_key varchar(40) NOT NULL,
  encrypted_config bytea NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'CREATED' CHECK (state IN ('CREATED','PENDING','REQUIRES_REDIRECT','VERIFYING','SUCCEEDED','FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED')),
  provider_authority varchar(255),
  provider_transaction_id varchar(255),
  provider_reference_id varchar(255),
  failure_code varchar(80),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, payment_id, attempt_number),
  UNIQUE (tenant_id, provider_key, provider_authority),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX payment_attempts_reconcile_idx ON payment_attempts (tenant_id, state, last_checked_at)
  WHERE state IN ('PENDING','REQUIRES_REDIRECT','VERIFYING');

CREATE TABLE invoices (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  invoice_number varchar(64) NOT NULL,
  snapshot jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, payment_id),
  UNIQUE (tenant_id, invoice_number),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE refunds (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  payment_attempt_id uuid NOT NULL,
  method varchar(8) NOT NULL CHECK (method IN ('PROVIDER','MANUAL')),
  status varchar(16) NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  amount bigint NOT NULL CHECK (amount > 0),
  currency varchar(3) NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(trim(reason)) > 0),
  reference varchar(255),
  actor_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CHECK (method <> 'MANUAL' OR (reference IS NOT NULL AND length(trim(reference)) > 0)),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payment_attempt_id) REFERENCES payment_attempts(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, actor_id) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT
);

CREATE TABLE payment_provider_events (
  tenant_id uuid NOT NULL,
  provider_key varchar(40) NOT NULL,
  event_id varchar(255) NOT NULL,
  payment_attempt_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_key, event_id),
  FOREIGN KEY (tenant_id, payment_attempt_id) REFERENCES payment_attempts(tenant_id, id) ON DELETE RESTRICT
);

RESET ROLE;
