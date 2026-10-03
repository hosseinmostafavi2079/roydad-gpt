ALTER TABLE tenant_database_registry
  DROP CONSTRAINT tenant_health_state_valid;

ALTER TABLE tenant_database_registry
  ADD CONSTRAINT tenant_health_state_valid
  CHECK (last_health_state IN ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILED', 'UNAVAILABLE'));
