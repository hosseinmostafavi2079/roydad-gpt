ALTER TABLE platform_admin_two_factors
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
