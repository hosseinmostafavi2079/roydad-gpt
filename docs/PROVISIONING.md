# Tenant provisioning

Provisioning is an auditable, idempotent workflow. Every transition is stored with a stable job ID, tenant ID, actor/request ID, timestamp, attempt, and safe failure code. Database names are generated as `eventos_t_<internal-id>` after strict validation.

```text
REQUESTED -> DATABASE_CREATING -> MIGRATING -> SEEDING -> VERIFYING -> ACTIVE
                    |                |           |            |
              FAILED_DATABASE  FAILED_MIGRATION FAILED_SEED FAILED_VERIFICATION
```

The control-plane transaction creates the tenant, job, and first audit event atomically. A dedicated provisioning adapter uses a separate privileged connection to create the empty tenant database. Reviewed forward-only migrations then establish its baseline schema and deterministic synthetic role templates. Verification checks migration version, expected baseline data, and connectivity. Only then may the tenant become ACTIVE. Public routing rejects all incomplete tenants.

Retries resume using the registered database name and migration ledger; they do not create duplicate databases, role rows, jobs, or successful transitions. Database creation is serialized for a tenant because PostgreSQL `CREATE DATABASE` cannot be placed in a transaction. Errors retain a correlation ID and do not expose provider/SQL credentials. A retry is an explicit audited operation after failure.

Local development can simulate deterministic success/failure scenarios. A simulation adapter is never selectable in production. Production deployment must configure a real PostgreSQL provisioning URL and migration role before provisioning is enabled.
