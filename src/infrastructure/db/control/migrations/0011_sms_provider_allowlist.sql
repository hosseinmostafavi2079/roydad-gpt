CREATE TABLE tenant_sms_provider_allowlist (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider_key varchar(40) NOT NULL CHECK (provider_key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  allowed boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES platform_admins(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,provider_key)
);
