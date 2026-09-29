CREATE TABLE tenant_schema_migrations (
  version varchar(80) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  tenant_id uuid NOT NULL UNIQUE,
  slug varchar(63) NOT NULL UNIQUE,
  provisioned_at timestamptz NOT NULL DEFAULT now(),
  schema_version varchar(80) NOT NULL
);

CREATE TABLE tenant_role_templates (
  code varchar(40) PRIMARY KEY,
  name varchar(120) NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_role_permissions_array CHECK (jsonb_typeof(permissions) = 'array')
);

INSERT INTO tenant_role_templates (code, name) VALUES
  ('organization_owner', 'Organization Owner'),
  ('organization_admin', 'Organization Admin'),
  ('course_manager', 'Course Manager'),
  ('instructor', 'Instructor'),
  ('attendance_officer', 'Attendance Officer'),
  ('finance', 'Finance'),
  ('support', 'Support'),
  ('content_manager', 'Content Manager'),
  ('analyst', 'Analyst'),
  ('reception', 'Reception'),
  ('participant', 'Participant')
ON CONFLICT (code) DO NOTHING;
