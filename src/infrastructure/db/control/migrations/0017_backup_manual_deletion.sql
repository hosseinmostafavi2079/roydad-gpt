CREATE TABLE platform_backup_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_job_id uuid NOT NULL REFERENCES platform_backup_jobs(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  request_id varchar(128) NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  state varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  safe_error_code varchar(64) CHECK (safe_error_code IS NULL OR safe_error_code = 'BACKUP_DELETE_FAILED'),
  safe_error_message varchar(500) CHECK (safe_error_message IS NULL OR safe_error_message = 'Backup deletion failed safely.'),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX backup_deletion_active_job_idx
  ON platform_backup_deletion_requests(backup_job_id) WHERE state IN ('QUEUED','RUNNING');
CREATE INDEX backup_deletion_queue_idx
  ON platform_backup_deletion_requests(created_at,id) WHERE state = 'QUEUED';
CREATE INDEX backup_deletion_job_history_idx
  ON platform_backup_deletion_requests(backup_job_id,created_at DESC,id DESC);
CREATE INDEX backup_verified_group_idx
  ON platform_backup_jobs(scope,tenant_id) WHERE state = 'SUCCEEDED' AND checksum_verified;
