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

## Initial owner without email (C1.2)

When email is disabled, supply owner name, username and mobile; email is optional. Iranian mobile and reserved username rules come from Identity V2. Password login must be enabled in the selected plan/overrides. An explicit email-free setup is also available with SMTP when owner email is omitted. Existing name/email SMTP requests retain their invitation flow.

The control transaction encrypts a random 32-byte activation code with the existing tenant-bound AES-GCM bootstrap key. The worker creates exactly one owner with `organization_owner`, STAFF profile, canonical unverified mobile and a credential record without a usable password. Existing `INVITED` denotes pending setup here; no email invitation/delivery row is created. The tenant verification accepts the pending activation record or an activated owner.

After ACTIVE, the authorized platform tenant-details page offers a deliberate one-time POST retrieval. The encrypted result is atomically removed when retrieved, is excluded from ordinary GET/RSC payloads, and expires 24 hours after creation. The operator transfers the username and code through a trusted channel. The owner opens `/owner-setup` on their tenant, enters the code in the form (never a URL), and chooses a personal password before first login. Setup atomically consumes the tenant-bound code and stores only an Argon2id password hash. The owner then logs in with username/password before mobile verification, configures their approved SMS provider, and verifies mobile through the existing OTP flow.

Do not retain or log the code. Refreshing after retrieval cannot recover it; expired/lost access requires an authorized operator-assisted recovery procedure, rather than a public reset or another email-free staff invitation feature. No temporary password or reusable access secret is stored in plaintext. Apply control `0012_owner_activation_result` and tenant `0015_owner_password_setup` using the existing reviewed migration procedures.
