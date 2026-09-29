ALTER TABLE platform_auth_verifications
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
