ALTER TABLE platform_auth_sessions
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
