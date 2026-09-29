\getenv control_app_password CONTROL_APP_PASSWORD
\getenv control_migration_password CONTROL_MIGRATION_PASSWORD
\getenv control_queue_password CONTROL_QUEUE_PASSWORD
\getenv tenant_provisioner_password TENANT_PROVISIONER_PASSWORD
\getenv tenant_runtime_password TENANT_RUNTIME_PASSWORD
\getenv tenant_migration_password TENANT_MIGRATION_PASSWORD

CREATE ROLE eventos_control_app LOGIN PASSWORD :'control_app_password';
CREATE ROLE eventos_control_migrator LOGIN PASSWORD :'control_migration_password';
CREATE ROLE eventos_control_queue LOGIN PASSWORD :'control_queue_password';
CREATE ROLE eventos_tenant_owner NOLOGIN;
CREATE ROLE eventos_tenant_provisioner LOGIN CREATEDB PASSWORD :'tenant_provisioner_password';
CREATE ROLE eventos_tenant_migrator LOGIN PASSWORD :'tenant_migration_password';
CREATE ROLE eventos_tenant_runtime LOGIN PASSWORD :'tenant_runtime_password';

GRANT eventos_tenant_owner TO eventos_tenant_provisioner;
GRANT eventos_tenant_owner TO eventos_tenant_migrator;

ALTER DATABASE eventos_control OWNER TO eventos_control_migrator;
GRANT CONNECT ON DATABASE eventos_control TO eventos_control_app, eventos_control_queue;
GRANT CREATE ON DATABASE eventos_control TO eventos_control_queue;
GRANT USAGE ON SCHEMA public TO eventos_control_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eventos_control_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eventos_control_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eventos_control_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eventos_control_app;

REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO eventos_tenant_provisioner,
  eventos_tenant_migrator, eventos_tenant_runtime;
