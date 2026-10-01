ALTER TABLE tenant_payment_provider_allowlist
  DROP CONSTRAINT tenant_payment_provider_allowlist_updated_by_fkey;

ALTER TABLE tenant_payment_provider_allowlist
  ALTER COLUMN updated_by TYPE uuid USING updated_by::uuid;

ALTER TABLE tenant_payment_provider_allowlist
  ADD CONSTRAINT tenant_payment_provider_allowlist_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES platform_admins(id) ON DELETE RESTRICT;
