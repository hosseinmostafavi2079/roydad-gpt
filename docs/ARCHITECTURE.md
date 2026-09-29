# Architecture

## Current phase

EventOS is a TypeScript modular monolith. Phase 1 platform administration, Phase 2 tenant identity/RBAC, and Phase 3 program scheduling are implemented. The browser UI is Persian-first and right-to-left; identifiers, validation errors, logs, and technical documentation remain English.

## Boundaries

- **Platform web/API:** Next.js server components and route handlers. Privileged operations call server-side use cases; UI code never connects to databases.
- **Platform auth:** Platform-administrator identities, sessions, and production TOTP MFA remain isolated in the control plane. Platform permissions are not tenant roles.
- **Control plane:** PostgreSQL stores SaaS metadata, plans, tenant/domain/branding/features/limits, provisioning state, platform authentication, and platform audit records.
- **Tenant identity/data plane:** each tenant has an independent PostgreSQL database. Tenant users, Better Auth accounts and sessions, invitations, normalized roles and permissions, profiles, and tenant audit records remain in that database.
- **Tenant auth request path:** resolve the trusted normalized host and active tenant first; select that tenant's database pool and tenant-specific Better Auth instance; validate the session tenant, current user status, and current role grants for each protected request. There is no global email lookup and authorization claims are not accepted from the browser.
- **Authorization:** centralized default-deny policies union assigned-role permissions. Tenant use cases enforce permissions and privilege bounds server-side. Navigation combines granted permissions with enabled tenant features. Phase 3 run/session reads also check instructor assignment relationships.
- **Provisioning:** an idempotent state machine coordinates database creation, migrations, deterministic seed, and verification. New tenant provisioning applies the current tenant schema and role seed before activation. A PostgreSQL-backed pg-boss queue is committed with the control-plane tenant/job record. Queue-level latency metrics and alerting are not configured.
- **Tenant database access:** a server-only provider maps trusted tenant IDs to registered database names and uses a bounded pool cache with disposal and resource limits.
- **Database access and migrations:** application reads/writes use parameterized `pg` queries. Prisma schema and reviewed forward-only Prisma SQL migrations define Phase 2 tenant schema changes; the runtime does not use a generated Prisma client. Phase 1/control-plane SQL migration history remains intact.
- **Shared foundations:** Zod validators, safe domain errors, request IDs, structured redacted logs, migration checks, and test utilities.
- **Shutdown lifecycle:** the Node runtime stops the provisioning queue and closes tenant/control database pools on SIGINT/SIGTERM, logs failures by resource name and error class only, then exits with a failure code if a resource did not close cleanly.

## Data and trust flow

```text
Browser -> Next.js route/server action -> validate origin and input
       -> trusted host resolver -> tenant context -> tenant-specific auth/session
       -> current user status + tenant role grants -> server-side permission policy
       -> bounded tenant pool -> tenant data

Platform admin -> provisioning state machine -> tenant DB create/migrations/seed/verification
```

Client-supplied tenant IDs, roles, feature flags, limits, database names, and database credentials are never trusted. Database identifiers are generated from stable internal IDs, validated, and quoted; SQL values use parameterized queries.

## Runtime and failure behavior

Liveness reports process health only. Readiness checks required control-plane dependencies and reports a generic status without connection details. Tenant DB failures are surfaced per tenant as safe health states, not raw database errors. Unexpected auth/API errors carry a request ID and do not expose database details, tokens, or credentials.

## Phase boundaries

Phase 2 provides tenant authentication, staff/instructor/participant identity profiles, invitations, roles, permissions, audit, and authorization foundations. Program/session/enrollment/finance/attendance/certificate workflows, and resource relationship tables needed for their fine-grained object authorization, remain future work. Production deployment and production readiness are not claimed.

## Architectural decision records

See `docs/ADR/` for the modular monolith, database-per-tenant boundary, trusted tenant resolution, platform authentication, connection pooling, and PostgreSQL/Prisma migration decisions.
## Phase 3 program core

Programs are reusable tenant-local definitions. Runs schedule delivery and hold capacity, registration windows, default venue, assigned instructors, and controlled publication state. Sessions hold UTC timestamps, tenant timezone, room, delivery mode, and optional instructor overrides. Venue and room records remain in the same tenant database. The calendar and dashboard query real tenant data through the permission-aware repository. Enrollment is intentionally outside this phase.
