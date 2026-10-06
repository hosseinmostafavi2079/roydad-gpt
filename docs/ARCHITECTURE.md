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

## Requested Phase 5 attendance and certificates

Migration `0008_phase5_attendance_certificates` adds attendance, QR challenge/use, template, and certificate tables to each tenant database. Composite foreign keys keep sessions, participants, runs, and templates tenant-local. The existing plan flags `attendance`, `qr_attendance`, and `certificates` control server paths; no duplicate feature state is stored.

Staff attendance writes lock the session row and require a valid enrollment. Instructor-only staff can access assigned sessions. QR tokens are HMAC-signed, tenant-bound, expire after 90 seconds, and are redeemed transactionally against a unique participant/challenge use and unique session attendance record. QR URLs put the token in a fragment, removed from browser history before redemption.

Certificates use controlled text placeholders and optional validated image assets. The server renders Persian PDFs to private S3-compatible storage; the database stores metadata and object keys. Issuance requires a completed run and valid enrollment, is unique per run/participant, and is audited. Public verification exposes only a minimal active-certificate result and uses a tenant-local rate limit. Platform usage includes attendance, certificate counts, and PDF bytes. Payment work remains outside this request.

The production image keeps Next's traced standalone server under `/app/standalone` and the full dependency tree under `/app/node_modules` for the provisioning worker and migration scripts. Keeping these trees separate avoids collisions between traced package directories and pnpm symlinks. The app server changes its working directory to the standalone folder; the PDF font is traced there.

## B1 custom domain core

The existing control-plane tenant_domains table represents pending (verified_at null), verified (verified_at present) and primary (is_primary) domains. No migration is required: global hostname uniqueness, challenge hash/expiry and the partial unique primary index already exist. BETTER_AUTH_URL supplies the platform origin; PLATFORM_BASE_DOMAIN supplies the generated subdomain namespace. Independent customer parent domains use exact verified CUSTOM mappings. Tenant creation has no DNS dependency.

Domain mutation APIs reuse withPlatformAdminRoute and its platform-host/session and same-origin checks. POST .../domains/:domainId/verification rotates a pending challenge; POST .../primary switches a verified same-tenant domain; DELETE .../domains/:domainId removes a non-primary domain while preserving a verified primary. Existing add/verify APIs remain. No authentication, SMS or registration implementation changes are included.

C1.2 initial-owner setup lives in the tenant-identity bootstrap use case. Platform tenant creation encrypts its tenant-bound activation payload; provisioning creates the pending owner, and a platform POST provides a one-time encrypted-result claim. Tenant activation chooses the first password before login. Existing SMTP invitations, participant registration and SMS adapters are separate and unchanged. See ADR 0012 and PROVISIONING.md.


C1.3 media storage: `infrastructure/media/storage.ts` provides put/get/delete selection by explicit `MEDIA_STORAGE_DRIVER=local|s3` (general default s3, Windows profile default local). Business repositories and authorized delivery routes retain object keys and metadata independently of the driver. The filesystem adapter is shared by the read-only tree validation, backup and opt-in S3 migration tools. No database migration is required.
