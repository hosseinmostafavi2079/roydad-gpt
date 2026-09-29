ALTER TABLE platform_auth_rate_limits
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
