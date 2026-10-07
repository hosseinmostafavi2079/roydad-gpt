CREATE TABLE platform_backup_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  scope varchar(24) NOT NULL DEFAULT 'FULL_PLATFORM',
  frequency varchar(16) NOT NULL,
  execution_time time(0) NOT NULL,
  weekday smallint,
  timezone varchar(64) NOT NULL,
  retention_count smallint NOT NULL,
  last_run_at timestamptz,
  next_run_at timestamptz,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_policy_scope_valid CHECK (scope = 'FULL_PLATFORM'),
  CONSTRAINT backup_policy_frequency_valid CHECK (frequency IN ('DAILY', 'WEEKLY')),
  CONSTRAINT backup_policy_weekday_valid CHECK (
    (frequency = 'DAILY' AND weekday IS NULL) OR
    (frequency = 'WEEKLY' AND weekday IS NOT NULL AND weekday BETWEEN 0 AND 6)
  ),
  CONSTRAINT backup_policy_time_valid CHECK (execution_time < time '24:00:00'),
  CONSTRAINT backup_policy_timezone_valid CHECK (char_length(timezone) BETWEEN 1 AND 64 AND timezone ~ '^[A-Za-z0-9_+/-]+$'),
  CONSTRAINT backup_policy_retention_valid CHECK (retention_count BETWEEN 1 AND 100),
  CONSTRAINT backup_policy_actor_valid CHECK (char_length(updated_by) BETWEEN 1 AND 200)
);

CREATE TABLE platform_backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope varchar(24) NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  trigger_type varchar(16) NOT NULL,
  state varchar(16) NOT NULL DEFAULT 'QUEUED',
  requested_by varchar(200),
  request_id varchar(128) NOT NULL,
  backup_key varchar(200) NOT NULL,
  size_bytes bigint,
  checksum_verified boolean NOT NULL DEFAULT false,
  safe_error_code varchar(64),
  safe_error_message varchar(500),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_job_scope_valid CHECK (scope IN ('FULL_PLATFORM', 'TENANT')),
  CONSTRAINT backup_job_tenant_valid CHECK (
    (scope = 'TENANT' AND tenant_id IS NOT NULL) OR
    (scope = 'FULL_PLATFORM' AND tenant_id IS NULL)
  ),
  CONSTRAINT backup_job_trigger_valid CHECK (trigger_type IN ('MANUAL', 'SCHEDULED')),
  CONSTRAINT backup_job_state_valid CHECK (state IN ('QUEUED', 'RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'PRUNED')),
  CONSTRAINT backup_job_size_valid CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT backup_job_request_valid CHECK (char_length(request_id) BETWEEN 1 AND 128),
  CONSTRAINT backup_job_key_valid CHECK (backup_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  CONSTRAINT backup_job_actor_valid CHECK (requested_by IS NULL OR char_length(requested_by) BETWEEN 1 AND 200),
  CONSTRAINT backup_job_error_code_valid CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT backup_job_error_message_valid CHECK (safe_error_message IS NULL OR (char_length(safe_error_message) BETWEEN 1 AND 500 AND safe_error_message !~ '[\r\n]'))
);

CREATE INDEX backup_jobs_recent_idx ON platform_backup_jobs (created_at DESC);
CREATE INDEX backup_jobs_state_idx ON platform_backup_jobs (state, created_at DESC);
CREATE INDEX backup_jobs_tenant_recent_idx ON platform_backup_jobs (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
