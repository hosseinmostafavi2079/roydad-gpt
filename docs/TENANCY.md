# Tenancy

The control plane stores tenant identity/configuration, plans and limits, domain/branding/features, database registry, provisioning jobs, platform identities, and platform audit events. Each tenant has an independent PostgreSQL database containing its users, Better Auth accounts/sessions, invitations, roles, permissions, staff/instructor/participant profiles, and tenant audit records. Tenant identities and grants are never looked up across databases.

## Resolution and authentication

Normalize the request hostname (lowercase IDNA ASCII, remove one trailing dot, reject invalid ports/labels and unsupported forms). Resolve only an exact verified custom-domain row or a subdomain under the configured platform base domain. Never use a request body, query, or client session tenant ID. Reject missing mappings and non-`ACTIVE` tenants before creating an immutable server-side context.

Tenant auth runs after host resolution and uses that tenant's bounded database pool. Separate tenant auth instances are keyed to the trusted tenant/database/origin context. A tenant session carries tenant ID and authentication level; every protected request compares that tenant ID with the resolved tenant, re-reads the user status, and resolves current role grants. Suspended and disabled accounts therefore cannot continue using an existing session. Platform administrator authentication remains separate.

The server-only tenant provider resolves database names from control-plane metadata, never from a client-supplied identifier. It keeps a bounded cache keyed by tenant ID and disposes idle/evicted pools. Acquisition has timeouts and safe backpressure. No shared mutable current-tenant setting or ORM URL mutation is used. Cross-tenant concurrency is covered using real PostgreSQL.

## Domains and caches

New custom domains remain unverified and cannot route. Verification tokens are random, time-bound, hashed at rest, and audited; production DNS verification must use a controlled challenge record. The bounded resolution cache is keyed by normalized hostname and stores a single tenant mapping; the bounded pool cache is keyed by immutable tenant ID and refuses a changed tenant-to-database mapping. Audited domain, branding, feature, limit, plan, and status changes invalidate affected resolution entries. Local preview behavior does not make arbitrary custom domains trusted.

## Tenant migration and upgrade procedure

The Phase 1 checksum-verified SQL migration history remains in place for the control plane and original tenant foundation. `prisma/tenant/schema.prisma` and the checked-in forward-only migrations under `prisma/tenant/migrations/` describe Phase 2 tenant schema. The Phase 2 bridge recognizes the existing Phase 1 tenant registry baseline, verifies the old tenant role-template state, creates Prisma migration history as a baseline without resetting or replaying the Phase 1 database, and then applies Phase 2 tenant identity/RBAC migrations. A tenant already at the Phase 2 version is verified and left unchanged on repeat runs.

For an existing environment, take and verify a database backup using the deployment's normal procedure, deploy the Phase 2 code and matching migration files, then run:

```powershell
pnpm db:migrate:tenants
```

The command visits active and suspended registered tenants in stable order, validates generated database identifiers and known migration versions, serializes each tenant upgrade with an advisory lock, updates the control-plane migration version and audit record after successful tenant verification, and returns a failing exit code if any database needs review. It does not delete, recreate, reset, or silently skip an unrecognized tenant database. Resolve a reported tenant failure and rerun; completed tenants are idempotently verified. New tenants receive the current schema and seeds automatically in provisioning before activation.

The Prisma schema is a schema/migration authoring and validation artifact; the runtime continues to use parameterized `pg` queries and does not require a generated Prisma client. Review both Prisma schema and emitted SQL before adding future migrations. Destructive migrations require a separately reviewed expand-and-contract plan.

## Isolation limits

Separate databases prevent ordinary cross-database joins and constrain accidental query scope, but PostgreSQL roles and application authorization still matter. A provisioning credential can reach all tenant databases and is never used for request queries. Production requires restricted network access, least privilege, encrypted transport/storage, backups, and tested restore procedures.
## Phase 3 migration

`0003_phase3_program_core` is a forward-only tenant Prisma SQL migration. New tenant provisioning applies it automatically. Existing Phase 1/2 tenants advance through `pnpm db:migrate:tenants` without dropping data; the migration runner verifies the tenant's recorded migration history and Phase 3 tables. Program, run, session, venue, room, and assignment IDs are resolved within the current tenant database. Cross-tenant IDs fail lookup or tenant-scoped foreign key checks.
