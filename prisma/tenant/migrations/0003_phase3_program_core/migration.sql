SET ROLE eventos_tenant_owner;

CREATE TABLE venues (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  address varchar(500) NOT NULL DEFAULT '',
  city varchar(120) NOT NULL DEFAULT '',
  description varchar(1000) NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT
);

CREATE TABLE rooms (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  description varchar(1000) NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, venue_id, name),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX rooms_venue_idx ON rooms (tenant_id, venue_id);

CREATE TABLE programs (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type varchar(24) NOT NULL CHECK (type IN ('COURSE','WORKSHOP','SEMINAR','WEBINAR','CONFERENCE','BOOTCAMP','PRIVATE_CLASS','EXAM','MEETING','EVENT')),
  title varchar(200) NOT NULL,
  slug varchar(100) NOT NULL,
  short_description varchar(500) NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category varchar(120) NOT NULL DEFAULT '',
  level varchar(80) NOT NULL DEFAULT '',
  objectives text NOT NULL DEFAULT '',
  prerequisites text NOT NULL DEFAULT '',
  intended_audience text NOT NULL DEFAULT '',
  default_duration_minutes integer CHECK (default_duration_minutes > 0),
  cover_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT
);
CREATE INDEX programs_status_idx ON programs (tenant_id, status, created_at DESC);

CREATE TABLE program_runs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  registration_starts_at timestamptz,
  registration_ends_at timestamptz,
  delivery_mode varchar(16) NOT NULL CHECK (delivery_mode IN ('IN_PERSON','ONLINE','HYBRID')),
  capacity integer NOT NULL CHECK (capacity > 0),
  minimum_capacity integer CHECK (minimum_capacity > 0 AND minimum_capacity <= capacity),
  waitlist_enabled boolean NOT NULL DEFAULT false,
  state varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','PRIVATE','PUBLISHED','CANCELLED','COMPLETED')),
  venue_id uuid,
  notes text NOT NULL DEFAULT '',
  created_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, program_id) REFERENCES programs(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  CHECK (starts_at < ends_at),
  CHECK (registration_starts_at IS NULL OR registration_ends_at IS NULL OR registration_starts_at < registration_ends_at)
);
CREATE INDEX program_runs_program_idx ON program_runs (tenant_id, program_id, starts_at DESC);
CREATE INDEX program_runs_state_idx ON program_runs (tenant_id, state, starts_at);

CREATE TABLE run_instructors (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  instructor_id varchar(64) NOT NULL,
  is_lead boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, run_id, instructor_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES program_runs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, instructor_id) REFERENCES tenant_instructor_profiles(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX run_one_lead_idx ON run_instructors (tenant_id, run_id) WHERE is_lead;
CREATE INDEX run_instructors_actor_idx ON run_instructors (tenant_id, instructor_id);

CREATE TABLE program_sessions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone varchar(80) NOT NULL,
  delivery_mode varchar(16) NOT NULL CHECK (delivery_mode IN ('IN_PERSON','ONLINE','HYBRID')),
  venue_id uuid,
  room_id uuid,
  online_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  attendance_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CANCELLED','COMPLETED')),
  created_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES program_runs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by) REFERENCES tenant_users("tenantId", id) ON DELETE RESTRICT,
  CHECK (starts_at < ends_at),
  CHECK (room_id IS NULL OR venue_id IS NOT NULL)
);
CREATE INDEX program_sessions_run_idx ON program_sessions (tenant_id, run_id, starts_at);
CREATE INDEX program_sessions_calendar_idx ON program_sessions (tenant_id, starts_at, ends_at) WHERE status = 'SCHEDULED';
CREATE INDEX program_sessions_room_idx ON program_sessions (tenant_id, room_id, starts_at) WHERE status = 'SCHEDULED' AND room_id IS NOT NULL;

CREATE TABLE session_instructors (
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  instructor_id varchar(64) NOT NULL,
  is_lead boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, session_id, instructor_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES program_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, instructor_id) REFERENCES tenant_instructor_profiles(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX session_one_lead_idx ON session_instructors (tenant_id, session_id) WHERE is_lead;
CREATE INDEX session_instructors_actor_idx ON session_instructors (tenant_id, instructor_id);

INSERT INTO tenant_permissions (tenant_id, key, module, name, description, high_risk)
SELECT tenant_id, 'instructor.manage', 'instructors', 'Assign instructors',
       'Assign instructor profiles to runs and sessions.', false
FROM tenant_metadata ON CONFLICT (tenant_id, key) DO NOTHING;
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, 'instructor.manage'
FROM tenant_roles AS role
WHERE role.code IN ('organization_owner', 'organization_admin', 'course_manager')
ON CONFLICT DO NOTHING;

RESET ROLE;
