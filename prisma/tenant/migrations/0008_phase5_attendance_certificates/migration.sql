SET ROLE eventos_tenant_owner;

CREATE TABLE attendance_records (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  participant_id varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('PRESENT','ABSENT','LATE','EXCUSED')),
  check_in_at timestamptz,
  marked_by_user_id varchar(64) NOT NULL,
  notes varchar(500),
  source varchar(8) NOT NULL CHECK (source IN ('STAFF','QR')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, session_id, participant_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES program_sessions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES tenant_participant_profiles(tenant_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, marked_by_user_id) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  CHECK ((status IN ('PRESENT','LATE')) = (check_in_at IS NOT NULL))
);
CREATE INDEX attendance_records_participant_idx ON attendance_records (tenant_id, participant_id, updated_at DESC);

CREATE TABLE attendance_qr_challenges (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  issued_by_user_id varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES program_sessions(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, issued_by_user_id) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);
CREATE INDEX attendance_qr_challenges_session_idx ON attendance_qr_challenges (tenant_id, session_id, expires_at DESC);

CREATE TABLE attendance_qr_uses (
  tenant_id uuid NOT NULL,
  challenge_id uuid NOT NULL,
  participant_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, challenge_id, participant_id),
  FOREIGN KEY (tenant_id, challenge_id) REFERENCES attendance_qr_challenges(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES tenant_participant_profiles(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX attendance_qr_uses_participant_idx ON attendance_qr_uses (tenant_id, participant_id, created_at DESC);

CREATE TABLE certificate_templates (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  background_object_key varchar(300),
  background_size_bytes bigint NOT NULL DEFAULT 0 CHECK (background_size_bytes >= 0),
  fields_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name),
  UNIQUE (background_object_key),
  FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT
);

ALTER TABLE program_runs ADD CONSTRAINT program_runs_tenant_id_id_program_id_key UNIQUE (tenant_id, id, program_id);

CREATE TABLE certificates (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id varchar(64) NOT NULL,
  program_id uuid NOT NULL,
  run_id uuid NOT NULL,
  template_id uuid NOT NULL,
  serial_number varchar(40) NOT NULL UNIQUE,
  verification_code varchar(64) NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by_user_id varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  revoked_at timestamptz,
  revoked_by_user_id varchar(64),
  pdf_object_key varchar(300) NOT NULL UNIQUE,
  pdf_size_bytes bigint NOT NULL CHECK (pdf_size_bytes > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, run_id, participant_id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES tenant_participant_profiles(tenant_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, run_id, program_id) REFERENCES program_runs(tenant_id, id, program_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, template_id) REFERENCES certificate_templates(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, issued_by_user_id) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, revoked_by_user_id) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX certificates_participant_idx ON certificates (tenant_id, participant_id, issued_at DESC);
CREATE INDEX certificates_program_idx ON certificates (tenant_id, program_id, issued_at DESC);

INSERT INTO tenant_permissions (tenant_id, key, module, name, description, high_risk)
SELECT metadata.tenant_id, permission.key, permission.module, permission.name, permission.description, permission.high_risk
FROM tenant_metadata AS metadata
CROSS JOIN (VALUES
  ('attendance.view','attendance','View attendance','View assigned or organization session attendance.',false),
  ('attendance.export','attendance','Export attendance','Export tenant-scoped attendance CSV.',true),
  ('attendance.self.read','attendance','View own attendance','View attendance for the authenticated participant.',false),
  ('attendance.checkin','attendance','QR check-in','Check in as the authenticated participant.',false),
  ('certificate.template.manage','certificates','Manage certificate templates','Manage controlled certificate layouts and images.',true),
  ('certificate.revoke','certificates','Revoke certificates','Revoke an issued certificate.',true),
  ('certificate.self.read','certificates','View own certificates','View certificates for the authenticated participant.',false)
) AS permission(key,module,name,description,high_risk)
ON CONFLICT (tenant_id,key) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, 'attendance.view'
FROM tenant_role_permissions AS old_grant
JOIN tenant_roles AS role ON role.tenant_id=old_grant.tenant_id AND role.id=old_grant.role_id
WHERE old_grant.permission_key='attendance.read'
ON CONFLICT DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.key
FROM tenant_roles AS role
CROSS JOIN (VALUES
  ('organization_owner','attendance.export'),
  ('organization_admin','attendance.export'),
  ('attendance_officer','attendance.export'),
  ('organization_owner','attendance.self.read'),
  ('organization_owner','attendance.checkin'),
  ('participant','attendance.self.read'),
  ('participant','attendance.checkin'),
  ('organization_owner','certificate.template.manage'),
  ('organization_admin','certificate.template.manage'),
  ('content_manager','certificate.template.manage'),
  ('organization_owner','certificate.revoke'),
  ('organization_admin','certificate.revoke'),
  ('organization_owner','certificate.self.read'),
  ('participant','certificate.self.read')
) AS permission(role_code,key)
WHERE role.code=permission.role_code
ON CONFLICT DO NOTHING;

DELETE FROM tenant_role_permissions AS role_grant
USING tenant_roles AS role
WHERE role_grant.tenant_id=role.tenant_id AND role_grant.role_id=role.id
  AND role.code='participant' AND role_grant.permission_key='certificate.read';

RESET ROLE;
