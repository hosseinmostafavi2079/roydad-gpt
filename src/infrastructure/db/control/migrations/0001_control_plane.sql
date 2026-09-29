CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(48) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,47}$'),
  CONSTRAINT plans_features_object CHECK (jsonb_typeof(features) = 'object'),
  CONSTRAINT plans_limits_object CHECK (jsonb_typeof(limits) = 'object')
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(63) NOT NULL UNIQUE,
  legal_name varchar(200) NOT NULL,
  display_name varchar(120) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PROVISIONING',
  plan_id uuid NOT NULL REFERENCES plans(id),
  locale varchar(24) NOT NULL DEFAULT 'fa-IR',
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Tehran',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT tenants_status_valid CHECK (status IN ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED')),
  CONSTRAINT tenants_locale_valid CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  CONSTRAINT tenants_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE tenant_database_registry (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  database_name varchar(63) NOT NULL UNIQUE,
  migration_version varchar(80),
  last_health_check_at timestamptz,
  last_health_state varchar(16) NOT NULL DEFAULT 'UNKNOWN',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_database_name_format CHECK (database_name ~ '^eventos_t_[0-9a-f]{32}$'),
  CONSTRAINT tenant_health_state_valid CHECK (last_health_state IN ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE'))
);

CREATE TABLE tenant_features (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key varchar(64) NOT NULL,
  enabled boolean NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key),
  CONSTRAINT tenant_feature_key_format CHECK (feature_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

CREATE TABLE tenant_limits (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  limit_key varchar(64) NOT NULL,
  limit_value integer NOT NULL CHECK (limit_value >= 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, limit_key),
  CONSTRAINT tenant_limit_key_format CHECK (limit_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

CREATE TABLE tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  brand_name varchar(120) NOT NULL,
  logo_asset_key varchar(512),
  primary_color varchar(7) NOT NULL DEFAULT '#145D58',
  accent_color varchar(7) NOT NULL DEFAULT '#C99047',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_branding_colors_valid CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$' AND accent_color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname varchar(253) NOT NULL UNIQUE,
  domain_type varchar(24) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  verification_token_hash char(64),
  verification_expires_at timestamptz,
  verified_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_domain_type_valid CHECK (domain_type IN ('PLATFORM_SUBDOMAIN', 'CUSTOM')),
  CONSTRAINT tenant_hostname_normalized CHECK (hostname = lower(hostname) AND hostname !~ '[[:space:]/:@]'),
  CONSTRAINT platform_subdomain_is_verified CHECK (domain_type <> 'PLATFORM_SUBDOMAIN' OR verified_at IS NOT NULL),
  CONSTRAINT custom_domain_challenge_state CHECK (
    domain_type <> 'CUSTOM' OR
    (verified_at IS NOT NULL AND verification_token_hash IS NULL) OR
    (verified_at IS NULL AND verification_token_hash IS NOT NULL AND verification_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX tenant_domains_one_primary_idx ON tenant_domains (tenant_id) WHERE is_primary;
CREATE INDEX tenant_domains_tenant_idx ON tenant_domains (tenant_id, hostname);

CREATE TABLE provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  queue_job_id uuid UNIQUE,
  state varchar(32) NOT NULL DEFAULT 'REQUESTED',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  requested_by text NOT NULL,
  request_id varchar(36) NOT NULL,
  error_code varchar(80),
  error_message varchar(300),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provisioning_state_valid CHECK (state IN (
    'REQUESTED', 'DATABASE_CREATING', 'MIGRATING', 'SEEDING', 'VERIFYING', 'ACTIVE',
    'FAILED_DATABASE', 'FAILED_MIGRATION', 'FAILED_SEED', 'FAILED_VERIFICATION'
  ))
);

CREATE INDEX provisioning_jobs_tenant_recent_idx ON provisioning_jobs (tenant_id, created_at DESC);
CREATE INDEX provisioning_jobs_state_idx ON provisioning_jobs (state, updated_at DESC);

CREATE TABLE provisioning_job_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES provisioning_jobs(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL,
  from_state varchar(32),
  to_state varchar(32) NOT NULL,
  actor_id text,
  request_id varchar(36) NOT NULL,
  safe_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, sequence_number),
  CONSTRAINT provisioning_transition_detail_object CHECK (jsonb_typeof(safe_detail) = 'object')
);

CREATE TABLE platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL UNIQUE REFERENCES platform_auth_users(id) ON DELETE RESTRICT,
  email varchar(320) NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type varchar(24) NOT NULL,
  actor_id text,
  action varchar(120) NOT NULL,
  target_type varchar(80) NOT NULL,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  request_id varchar(36) NOT NULL,
  source_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_audit_actor_valid CHECK (actor_type IN ('PLATFORM_ADMIN', 'SYSTEM'))
);

CREATE INDEX platform_audit_target_recent_idx ON platform_audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX platform_audit_actor_recent_idx ON platform_audit_logs (actor_id, created_at DESC);

CREATE FUNCTION prevent_platform_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform audit records are append-only';
END;
$$;

CREATE TRIGGER platform_audit_immutable
  BEFORE UPDATE OR DELETE ON platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_platform_audit_mutation();

INSERT INTO plans (code, name, description, features, limits)
VALUES (
  'foundation',
  'Foundation',
  'Conservative default plan; platform administrators can configure its features and limits.',
  '{"courses":false,"events":false,"attendance":false,"qr_attendance":false,"payments":false,"certificates":false,"quiz":false,"assignments":false,"crm":false,"sms":false,"email":false,"ai":false,"custom_domain":false,"branches":false}'::jsonb,
  '{"max_staff":5,"max_participants":100,"max_active_runs":10,"max_storage_mb":1024,"monthly_sms":0,"monthly_email":100,"max_branches":1,"max_custom_domains":0}'::jsonb
)
ON CONFLICT (code) DO NOTHING;
