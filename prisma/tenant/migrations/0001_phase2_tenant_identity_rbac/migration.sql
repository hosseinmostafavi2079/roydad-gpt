SET ROLE eventos_tenant_owner;

CREATE TABLE tenant_users (
  id varchar(64) PRIMARY KEY,
  "tenantId" uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  email varchar(320) NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'INVITED',
  mobile varchar(32),
  "mobileVerifiedAt" timestamptz,
  "lastLoginAt" timestamptz,
  "failedLoginCount" integer NOT NULL DEFAULT 0,
  "lockedUntil" timestamptz,
  CONSTRAINT tenant_users_status_valid CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
  CONSTRAINT tenant_users_email_normalized CHECK (email = lower(email)),
  CONSTRAINT tenant_users_failed_login_count_valid CHECK ("failedLoginCount" >= 0),
  CONSTRAINT tenant_users_tenant_id_id_key UNIQUE ("tenantId", id),
  CONSTRAINT tenant_users_tenant_id_email_key UNIQUE ("tenantId", email),
  CONSTRAINT tenant_users_tenant_id_mobile_key UNIQUE ("tenantId", mobile)
);
CREATE INDEX tenant_users_tenant_id_status_idx ON tenant_users ("tenantId", status);

CREATE TABLE tenant_auth_sessions (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "expiresAt" timestamptz NOT NULL,
  token varchar(255) NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" varchar(45),
  "userAgent" text,
  "userId" varchar(64) NOT NULL,
  "tenantId" uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE CASCADE,
  "authenticationLevel" varchar(32) NOT NULL DEFAULT 'PASSWORD',
  CONSTRAINT tenant_auth_sessions_user_fk FOREIGN KEY ("tenantId", "userId")
    REFERENCES tenant_users("tenantId", id) ON DELETE CASCADE
);
CREATE INDEX tenant_auth_sessions_userId_idx ON tenant_auth_sessions ("userId");
CREATE INDEX tenant_auth_sessions_tenant_expires_idx ON tenant_auth_sessions ("tenantId", "expiresAt");

CREATE TABLE tenant_auth_accounts (
  id varchar(64) PRIMARY KEY,
  "accountId" varchar(255) NOT NULL,
  "providerId" varchar(100) NOT NULL,
  "userId" varchar(64) NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_auth_accounts_provider_account_key UNIQUE ("providerId", "accountId")
);
CREATE INDEX tenant_auth_accounts_userId_idx ON tenant_auth_accounts ("userId");

CREATE TABLE tenant_auth_verifications (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identifier varchar(255) NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_auth_verifications_identifier_idx ON tenant_auth_verifications (identifier);

CREATE TABLE tenant_auth_rate_limits (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key varchar(255) NOT NULL UNIQUE,
  count integer NOT NULL,
  "lastRequest" bigint NOT NULL,
  CONSTRAINT tenant_auth_rate_limits_count_valid CHECK (count >= 0)
);

CREATE TABLE tenant_permissions (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  key varchar(64) NOT NULL,
  module varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  high_risk boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_permissions_key_format CHECK (key ~ '^[a-z][a-z0-9.]{1,63}$'),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE tenant_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  code varchar(80) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_roles_code_format CHECK (code ~ '^[a-z][a-z0-9_-]{1,79}$'),
  CONSTRAINT tenant_roles_tenant_id_code_key UNIQUE (tenant_id, code),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX tenant_roles_name_norm_key ON tenant_roles (tenant_id, lower(name));
CREATE INDEX tenant_roles_tenant_id_system_idx ON tenant_roles (tenant_id, is_system);

CREATE TABLE tenant_user_roles (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  user_id varchar(64) NOT NULL,
  role_id uuid NOT NULL,
  assigned_by varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_user_roles_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_users("tenantId", id) ON DELETE CASCADE,
  CONSTRAINT tenant_user_roles_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES tenant_roles(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tenant_user_roles_assigned_by_fk FOREIGN KEY (assigned_by)
    REFERENCES tenant_users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, user_id, role_id)
);
CREATE INDEX tenant_user_roles_tenant_role_idx ON tenant_user_roles (tenant_id, role_id);

CREATE TABLE tenant_role_permissions (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,
  permission_key varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_role_permissions_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES tenant_roles(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT tenant_role_permissions_permission_fk FOREIGN KEY (tenant_id, permission_key)
    REFERENCES tenant_permissions(tenant_id, key) ON DELETE RESTRICT,
  PRIMARY KEY (tenant_id, role_id, permission_key)
);
CREATE INDEX tenant_role_permissions_tenant_permission_idx ON tenant_role_permissions (tenant_id, permission_key);

CREATE TABLE tenant_staff_profiles (
  tenant_id uuid NOT NULL,
  user_id varchar(64) NOT NULL,
  title varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_staff_profiles_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_users("tenantId", id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE tenant_instructor_profiles (
  tenant_id uuid NOT NULL,
  user_id varchar(64) NOT NULL,
  display_name varchar(120) NOT NULL,
  bio varchar(2000) NOT NULL DEFAULT '',
  specialties text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_instructor_profiles_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_users("tenantId", id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE tenant_participant_profiles (
  tenant_id uuid NOT NULL,
  user_id varchar(64) NOT NULL,
  display_name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_participant_profiles_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_users("tenantId", id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  user_id varchar(64) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  invited_by varchar(64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_invitations_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tenant_invitations_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES tenant_users("tenantId", id) ON DELETE CASCADE,
  CONSTRAINT tenant_invitations_invited_by_fk FOREIGN KEY (invited_by)
    REFERENCES tenant_users(id) ON DELETE SET NULL
);
CREATE INDEX tenant_invitations_user_expiry_idx ON tenant_invitations (tenant_id, user_id, expires_at);
CREATE UNIQUE INDEX tenant_invitations_one_pending_per_user_idx
  ON tenant_invitations (tenant_id, user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE tenant_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  actor_id varchar(64),
  action varchar(120) NOT NULL,
  target_type varchar(64) NOT NULL,
  target_id varchar(128),
  request_id varchar(36) NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_audit_request_id_format CHECK (request_id ~ '^[0-9a-f-]{36}$'),
  CONSTRAINT tenant_audit_actor_fk FOREIGN KEY (tenant_id, actor_id)
    REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  CONSTRAINT tenant_audit_before_object CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'object'),
  CONSTRAINT tenant_audit_after_object CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'object')
);
CREATE INDEX tenant_audit_target_recent_idx ON tenant_audit_logs (tenant_id, target_type, target_id, created_at DESC);
CREATE INDEX tenant_audit_actor_recent_idx ON tenant_audit_logs (tenant_id, actor_id, created_at DESC);

CREATE FUNCTION prevent_tenant_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tenant audit records are append-only';
END;
$$;
CREATE TRIGGER tenant_audit_immutable
  BEFORE UPDATE OR DELETE ON tenant_audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();

INSERT INTO tenant_permissions (tenant_id, key, module, name, description, high_risk)
SELECT meta.tenant_id, item.key, item.module, item.name, item.description, item.high_risk
FROM tenant_metadata AS meta
CROSS JOIN (VALUES
  ('dashboard.read', 'dashboard', 'View dashboard', 'Open the tenant dashboard.', false),
  ('staff.read', 'staff', 'View staff', 'View tenant staff accounts.', false),
  ('staff.create', 'staff', 'Invite staff', 'Invite and create staff accounts.', false),
  ('staff.update', 'staff', 'Update staff', 'Update staff profile details.', false),
  ('staff.suspend', 'staff', 'Change staff status', 'Suspend or reactivate staff accounts.', false),
  ('staff.delete', 'staff', 'Disable staff', 'Disable staff accounts.', true),
  ('role.read', 'roles', 'View roles', 'View roles and their grants.', false),
  ('role.create', 'roles', 'Create roles', 'Create custom tenant roles.', false),
  ('role.update', 'roles', 'Update roles', 'Change custom role details and grants.', true),
  ('role.delete', 'roles', 'Delete roles', 'Delete custom roles.', true),
  ('role.assign', 'roles', 'Assign roles', 'Assign roles to tenant users.', true),
  ('role.manage', 'roles', 'Manage role authority', 'Administer role grants and protected role assignments.', true),
  ('participant.read', 'participants', 'View participants', 'View participant profiles within authorized scope.', false),
  ('participant.create', 'participants', 'Invite participants', 'Invite participant identities.', false),
  ('participant.update', 'participants', 'Update participants', 'Update participant profile details.', false),
  ('participant.suspend', 'participants', 'Change participant status', 'Suspend participant accounts.', false),
  ('instructor.read', 'instructors', 'View instructors', 'View instructor profiles.', false),
  ('instructor.create', 'instructors', 'Invite instructors', 'Invite instructor identities.', false),
  ('instructor.update', 'instructors', 'Update instructors', 'Update instructor profiles.', false),
  ('instructor.suspend', 'instructors', 'Change instructor status', 'Suspend instructor accounts.', false),
  ('program.read', 'programs', 'View programs', 'Future program access permission.', false),
  ('program.create', 'programs', 'Create programs', 'Future program access permission.', false),
  ('program.update', 'programs', 'Update programs', 'Future program access permission.', false),
  ('program.delete', 'programs', 'Delete programs', 'Future program access permission.', false),
  ('program.publish', 'programs', 'Publish programs', 'Future program access permission.', false),
  ('session.read', 'sessions', 'View sessions', 'Future session access permission.', false),
  ('session.manage', 'sessions', 'Manage sessions', 'Future session access permission.', false),
  ('enrollment.read', 'enrollment', 'View enrollment', 'Future enrollment access permission.', false),
  ('enrollment.manage', 'enrollment', 'Manage enrollment', 'Future enrollment access permission.', false),
  ('attendance.read', 'attendance', 'View attendance', 'Future attendance access permission.', false),
  ('attendance.manage', 'attendance', 'Manage attendance', 'Future attendance access permission.', false),
  ('finance.read', 'finance', 'View finance', 'Future finance access permission.', true),
  ('payment.manage', 'finance', 'Manage payments', 'Future payment access permission.', true),
  ('refund.manage', 'finance', 'Manage refunds', 'Future refund access permission.', true),
  ('certificate.read', 'certificates', 'View certificates', 'Future certificate access permission.', false),
  ('certificate.issue', 'certificates', 'Issue certificates', 'Future certificate access permission.', false),
  ('report.read', 'reports', 'View reports', 'View tenant reports.', false),
  ('settings.read', 'settings', 'View settings', 'View tenant settings.', false),
  ('settings.manage', 'settings', 'Manage settings', 'Change tenant settings.', true),
  ('audit.read', 'audit', 'View audit log', 'View tenant security audit records.', true)
) AS item(key, module, name, description, high_risk)
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO tenant_roles (tenant_id, code, name, description, is_system)
SELECT meta.tenant_id, item.code, item.name, item.description, true
FROM tenant_metadata AS meta
CROSS JOIN (VALUES
  ('organization_owner', 'Organization Owner', 'Full tenant administration; grants are explicit and seeded.'),
  ('organization_admin', 'Organization Admin', 'Manage day-to-day organization operations within granted permissions.'),
  ('course_manager', 'Course Manager', 'Manage future program and session workflows.'),
  ('instructor', 'Instructor', 'Instructor identity with scoped future teaching permissions.'),
  ('attendance_officer', 'Attendance Officer', 'Manage future attendance workflows.'),
  ('finance', 'Finance', 'Manage future finance operations.'),
  ('support', 'Support', 'Read support-facing tenant information.'),
  ('content_manager', 'Content Manager', 'Manage future program content.'),
  ('analyst', 'Analyst', 'Read reports and permitted operational summaries.'),
  ('reception', 'Reception', 'Support participant-facing intake and future enrollment.'),
  ('participant', 'Participant', 'Participant portal access only.')
) AS item(code, name, description)
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.key
FROM tenant_roles AS role
JOIN tenant_permissions AS permission ON permission.tenant_id = role.tenant_id
WHERE role.code = 'organization_owner'
ON CONFLICT DO NOTHING;

WITH grants(role_code, permission_key) AS (VALUES
  ('organization_admin', 'dashboard.read'),
  ('organization_admin', 'staff.read'), ('organization_admin', 'staff.create'), ('organization_admin', 'staff.update'), ('organization_admin', 'staff.suspend'),
  ('organization_admin', 'role.read'), ('organization_admin', 'role.create'), ('organization_admin', 'role.update'), ('organization_admin', 'role.assign'),
  ('organization_admin', 'participant.read'), ('organization_admin', 'participant.create'), ('organization_admin', 'participant.update'), ('organization_admin', 'participant.suspend'),
  ('organization_admin', 'instructor.read'), ('organization_admin', 'instructor.create'), ('organization_admin', 'instructor.update'), ('organization_admin', 'instructor.suspend'),
  ('organization_admin', 'program.read'), ('organization_admin', 'program.create'), ('organization_admin', 'program.update'),
  ('organization_admin', 'session.read'), ('organization_admin', 'session.manage'), ('organization_admin', 'enrollment.read'), ('organization_admin', 'enrollment.manage'),
  ('organization_admin', 'attendance.read'), ('organization_admin', 'attendance.manage'), ('organization_admin', 'certificate.read'), ('organization_admin', 'certificate.issue'),
  ('organization_admin', 'report.read'), ('organization_admin', 'settings.read'), ('organization_admin', 'audit.read'),
  ('course_manager', 'dashboard.read'), ('course_manager', 'program.read'), ('course_manager', 'program.create'), ('course_manager', 'program.update'), ('course_manager', 'program.publish'),
  ('course_manager', 'session.read'), ('course_manager', 'session.manage'), ('course_manager', 'enrollment.read'), ('course_manager', 'enrollment.manage'), ('course_manager', 'instructor.read'), ('course_manager', 'participant.read'), ('course_manager', 'report.read'),
  ('instructor', 'dashboard.read'), ('instructor', 'program.read'), ('instructor', 'session.read'), ('instructor', 'participant.read'), ('instructor', 'enrollment.read'), ('instructor', 'attendance.read'), ('instructor', 'attendance.manage'),
  ('attendance_officer', 'dashboard.read'), ('attendance_officer', 'attendance.read'), ('attendance_officer', 'attendance.manage'), ('attendance_officer', 'participant.read'), ('attendance_officer', 'session.read'),
  ('finance', 'dashboard.read'), ('finance', 'finance.read'), ('finance', 'payment.manage'), ('finance', 'refund.manage'), ('finance', 'report.read'),
  ('support', 'dashboard.read'), ('support', 'staff.read'), ('support', 'participant.read'), ('support', 'instructor.read'), ('support', 'program.read'), ('support', 'session.read'),
  ('content_manager', 'dashboard.read'), ('content_manager', 'program.read'), ('content_manager', 'program.create'), ('content_manager', 'program.update'), ('content_manager', 'program.publish'), ('content_manager', 'certificate.read'), ('content_manager', 'certificate.issue'),
  ('analyst', 'dashboard.read'), ('analyst', 'program.read'), ('analyst', 'session.read'), ('analyst', 'enrollment.read'), ('analyst', 'attendance.read'), ('analyst', 'finance.read'), ('analyst', 'report.read'),
  ('reception', 'dashboard.read'), ('reception', 'participant.read'), ('reception', 'participant.create'), ('reception', 'participant.update'), ('reception', 'enrollment.read'), ('reception', 'enrollment.manage'), ('reception', 'session.read'),
  ('participant', 'dashboard.read'), ('participant', 'enrollment.read'), ('participant', 'certificate.read')
)
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, grants.permission_key
FROM tenant_roles AS role
JOIN grants ON grants.role_code = role.code
JOIN tenant_permissions AS permission
  ON permission.tenant_id = role.tenant_id AND permission.key = grants.permission_key
ON CONFLICT DO NOTHING;

RESET ROLE;
