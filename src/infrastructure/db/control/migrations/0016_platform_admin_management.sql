ALTER TABLE platform_admins ADD COLUMN activated_at timestamptz;
UPDATE platform_admins SET activated_at = created_at;
-- Preserve initial-only bootstrap and existing trusted development seed semantics.
-- The management service explicitly supplies NULL for new pending identities.
ALTER TABLE platform_admins ALTER COLUMN activated_at SET DEFAULT now();

CREATE TABLE platform_admin_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id uuid NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (failed_attempt_count BETWEEN 0 AND 5),
  locked_until timestamptz,
  created_by_admin_id uuid REFERENCES platform_admins(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX platform_admin_one_activation_idx
  ON platform_admin_activations(platform_admin_id) WHERE consumed_at IS NULL;
