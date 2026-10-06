ALTER TABLE provisioning_jobs ADD COLUMN owner_access_ciphertext bytea, ADD COLUMN owner_access_expires_at timestamptz;
ALTER TABLE provisioning_jobs ADD CONSTRAINT owner_access_size CHECK (owner_access_ciphertext IS NULL OR octet_length(owner_access_ciphertext) <= 2048);
