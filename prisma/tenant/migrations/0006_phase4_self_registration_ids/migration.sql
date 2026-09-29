SET ROLE eventos_tenant_owner;

ALTER TABLE tenant_users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE tenant_auth_accounts ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

RESET ROLE;
