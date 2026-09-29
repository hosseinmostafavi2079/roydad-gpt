SET ROLE eventos_tenant_owner;

ALTER TABLE program_runs
  ADD COLUMN registration_form_schema jsonb NOT NULL DEFAULT '{"version":1,"fields":[]}'::jsonb;

CREATE TABLE enrollments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  participant_id varchar(64) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('PENDING','CONFIRMED','WAITLISTED','CANCELLED','COMPLETED')),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  form_schema_snapshot jsonb NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, run_id, participant_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES program_runs(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES tenant_participant_profiles(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX enrollments_run_status_idx ON enrollments (tenant_id, run_id, status, registered_at);
CREATE INDEX enrollments_participant_idx ON enrollments (tenant_id, participant_id, registered_at DESC);

INSERT INTO tenant_permissions (tenant_id, key, module, name, description, high_risk)
SELECT tenant_id, 'enrollment.read', 'enrollment', 'Read enrollments', 'View registrations in this organization.', false
FROM tenant_metadata ON CONFLICT (tenant_id, key) DO NOTHING;
INSERT INTO tenant_permissions (tenant_id, key, module, name, description, high_risk)
SELECT tenant_id, 'enrollment.manage', 'enrollment', 'Manage enrollments', 'Cancel registrations in this organization.', false
FROM tenant_metadata ON CONFLICT (tenant_id, key) DO NOTHING;
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.key
FROM tenant_roles AS role
CROSS JOIN (VALUES ('enrollment.read'), ('enrollment.manage')) AS permission(key)
WHERE role.code IN ('organization_owner', 'organization_admin', 'course_manager')
ON CONFLICT DO NOTHING;

RESET ROLE;
