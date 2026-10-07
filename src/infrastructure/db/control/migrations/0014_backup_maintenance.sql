-- Enforce one platform policy and retain durable proof before host-side deletion.
CREATE UNIQUE INDEX backup_policy_single_scope_idx ON platform_backup_policies (scope);
ALTER TABLE platform_backup_jobs
  ADD COLUMN prune_authorized_by uuid REFERENCES platform_backup_jobs(id) ON DELETE RESTRICT,
  ADD COLUMN prune_authorized_at timestamptz,
  ADD CONSTRAINT backup_prune_authorization_pair CHECK (
    (prune_authorized_by IS NULL AND prune_authorized_at IS NULL) OR
    (prune_authorized_by IS NOT NULL AND prune_authorized_at IS NOT NULL)
  );
