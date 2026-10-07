CREATE TABLE platform_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 incident_ref varchar(48) NOT NULL UNIQUE CHECK (incident_ref ~ '^INC-[0-9]{8}-[A-F0-9]{32}$'),
 status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RECOVERED')),
 severity varchar(16) NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR','CRITICAL')),
 component varchar(64) NOT NULL CHECK (component ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 event_code varchar(64) NOT NULL CHECK (event_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
 summary varchar(500) NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500 AND summary !~ '[\r\n]'),
 probable_cause varchar(500) CHECK (probable_cause !~ '[\r\n]'),
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 recovered_at timestamptz, occurrence_count bigint NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
 latest_request_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status='OPEN' AND recovered_at IS NULL) OR (status='RECOVERED' AND recovered_at IS NOT NULL))
);
CREATE UNIQUE INDEX diagnostic_open_correlation_idx ON platform_incidents
 (component,event_code,COALESCE(tenant_id::text,'platform')) WHERE status='OPEN';
CREATE INDEX diagnostic_incidents_recent_idx ON platform_incidents(last_seen_at DESC);
CREATE INDEX diagnostic_incidents_status_idx ON platform_incidents(status,last_seen_at DESC);
CREATE INDEX diagnostic_incidents_tenant_idx ON platform_incidents(tenant_id,last_seen_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX diagnostic_incidents_severity_idx ON platform_incidents(severity,last_seen_at DESC);
CREATE INDEX diagnostic_provisioning_failed_idx ON provisioning_jobs(updated_at DESC)
 WHERE state IN ('FAILED_DATABASE','FAILED_MIGRATION','FAILED_SEED','FAILED_VERIFICATION');
CREATE TABLE platform_diagnostic_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 severity varchar(16) NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR','CRITICAL')),
 component varchar(64) NOT NULL CHECK (component ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 event_code varchar(64) NOT NULL CHECK (event_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 safe_message varchar(500) NOT NULL CHECK (char_length(safe_message) BETWEEN 1 AND 500 AND safe_message !~ '[\r\n]'),
 tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT, request_id uuid, related_job_id uuid,
 incident_id uuid REFERENCES platform_incidents(id) ON DELETE RESTRICT,
 safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata)='object' AND octet_length(safe_metadata::text)<=4096),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diagnostic_events_recent_idx ON platform_diagnostic_events(occurred_at DESC);
CREATE INDEX diagnostic_events_severity_idx ON platform_diagnostic_events(severity,occurred_at DESC);
CREATE INDEX diagnostic_events_incident_idx ON platform_diagnostic_events(incident_id,occurred_at DESC);
CREATE INDEX diagnostic_events_tenant_idx ON platform_diagnostic_events(tenant_id,occurred_at DESC) WHERE tenant_id IS NOT NULL;
CREATE TABLE platform_component_heartbeats (
 component varchar(64) PRIMARY KEY CHECK (component ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 status varchar(16) NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','UNAVAILABLE','UNKNOWN')),
 safe_message varchar(500) CHECK (safe_message !~ '[\r\n]'),
 last_seen_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
