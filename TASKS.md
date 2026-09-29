# Phase 1 — Platform Foundation

This file preserves the Phase 1 acceptance record and tracks the current phase below. Work is limited to Phase 2 until its gates pass; do not begin Phase 3.

## Acceptance criteria

### Step 1 — Bootstrap and quality

- [x] Initialize a strict TypeScript, Persian-first RTL web application in the empty repository.
- [x] Pin all dependencies in the repository package-manager lockfile.
- [x] Add formatting, lint, type-check, unit/integration/E2E test, production build, and security-scan scripts/CI.
- [x] Validate environment configuration at startup and provide placeholders only in `.env.example`.
- [x] Add local PostgreSQL development configuration and safe structured logging with request IDs and secret redaction.
- [x] Record baseline constraints and architecture decisions before implementation.

### Step 2 — Control plane

- [x] Add reviewed, forward-only PostgreSQL migrations for plans, tenants, domains, branding, feature flags, limits, database registry, platform administrators/authentication, provisioning jobs, and append-only platform audit records.
- [x] Add platform administrator sign-in/sign-out with server-validated sessions, Argon2id password hashing, login throttling, CSRF/origin protection, and mandatory TOTP MFA in production.
- [x] Provide a non-production-only, idempotent bootstrap command for a synthetic platform admin; never expose public admin registration.
- [x] Implement authenticated server-side tenant create/read/update, status transitions, plan assignment, limits, features, branding, and domain metadata.
- [x] Audit security-sensitive platform changes with actor, target, request ID, and redacted before/after values.
- [x] Provide an accessible, responsive, Persian-first RTL platform sign-in and tenant management UI.

### Step 3 — Tenant provisioning

- [x] Implement an explicit, idempotent, retryable provisioning state machine with a persistent record for every transition and safe failure states.
- [x] Create one independent PostgreSQL database per tenant using a generated, validated database name; never derive SQL identifiers from untrusted tenant input.
- [x] Keep provisioning/migration credentials separate from control-plane and tenant runtime credentials; never persist or log connection secrets.
- [x] Apply reviewed tenant migrations and deterministic, synthetic baseline role seeds, then verify the database before activating the tenant.
- [x] Do not create duplicate tenant databases, seed rows, jobs, or transitions when requests/retries race.
- [x] Surface provisioning progress, failures, retry action, and safe health status in the platform UI/API.

### Step 4 — Tenant resolution foundation

- [x] Normalize hosts and resolve only exact, verified custom-domain mappings or configured platform subdomains.
- [x] Reject unknown, unverified, suspended, or non-active tenant domains before attaching a typed server-side tenant context.
- [x] Provide a bounded tenant database pool cache with stable tenant-to-database mapping, timeouts, eviction/disposal, and sanitized telemetry.
- [x] Prove concurrent Tenant A and Tenant B resolution/database acquisition cannot share tenant context or database handles.
- [x] Scope any cache keys by tenant; invalidate domain, branding, feature, and limit entries on relevant audited changes.

### Required documentation

- [x] Keep `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/THREAT_MODEL.md`, `docs/TESTING.md`, `docs/DEPLOYMENT.md`, `docs/BACKUP_RESTORE.md`, `docs/TENANCY.md`, `docs/PROVISIONING.md`, and the required ADRs accurate to implemented behavior.
- [x] Track later-phase RBAC and payments documentation without claiming those features exist.

### Phase 1 verification gates

- [x] Formatter/check, lint, strict TypeScript check, relevant unit tests, real PostgreSQL integration/migration tests, and production build pass.
- [x] Playwright covers platform-admin login, tenant creation/configuration, provisioning completion and failure/retry, and access denial.
- [x] Security checks cover unauthorized access, CSRF/origin, rate limiting, unverified/unknown domain rejection, cross-tenant resolution, and provisioning idempotency/races.
- [x] Review the final diff for tenant isolation, secret exposure, SQL identifier safety, unsafe migrations, and undocumented behavior.
- [x] Do not begin Phase 2 until all Phase 1 gates pass or an external blocker is documented with concrete evidence.

## Phase 1 scope boundaries at completion

- Tenant user sign-in/session flows, staff/instructor/participant identities, RBAC policies, and authorization matrices (Phase 2).
- Programs, runs, sessions, scheduling, registrations, commerce, payments, attendance, QR codes, notifications, certificates, and reports (Phases 3–6).
- Production deployment, production-ready operations, and claims of production readiness.

## Verification evidence

- `pnpm format`, `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm build` passed.
- `pnpm test:e2e:run` passed the platform-admin browser flow in installed local Chrome because the Playwright Chromium CDN returned HTTP 403 in this environment; teardown removed its ephemeral tenant/admin data and stopped the exact standalone server process. CI installs pinned Playwright Chromium.
- `pnpm audit --prod --audit-level high` reported no known vulnerabilities.
- Pinned Gitleaks v8.30.0 passed on `src`, `scripts`, `tests`, `docs`, and `.github` (the local `.env` was excluded).
- Source review covered tenant database identifier validation, provisioning transitions and retries, exact host resolution, tenant-scoped pool caching, origin checks, and bootstrap log redaction.
- Phase 1 was initially verified before this workspace was connected to Git. The repository is now on `main` with an `origin` remote; GitHub Actions and CodeQL have run during Phase 2.
- Production deployment and backup/restore readiness remain out of scope and are not claimed.

## Phase 2 — Tenant Identity, RBAC & Authorization

### Current gate status

Phase 2 remains open. CodeQL, secret scanning, and real-PostgreSQL integration tests now pass in GitHub Actions, but the next remote quality run failed at `pnpm build`. CI exports `NODE_ENV=development` for setup, and the old package script passed it to `next build`. The same environment reproduced Next's non-standard-mode warning, generated viewport/head key warnings, and `/_global-error` `useContext` prerender failure locally; the unchanged application built successfully with `NODE_ENV=production`. The build script and CI build step now set `NODE_ENV=production` and `MAIL_TRANSPORT=smtp` only for the build. Mail delivery selection uses explicit `MAIL_TRANSPORT`, never `NODE_ENV`; production rejects test transport outside the validated Playwright preload. Do not begin Phase 3 until the updated GitHub quality workflow passes.

- After the environment separation fix, local `pnpm check` passed; unit tests passed (7 files/30 tests); PostgreSQL integration tests passed (1 file/5 tests) with parent `NODE_ENV=development` and `MAIL_TRANSPORT=smtp`; production build passed even with parent `MAIL_TRANSPORT=test`; Playwright passed on a clean single run and a separate CI-style run (1 browser flow each). A local browser run first exposed a missing default on `platform_auth_verifications.id`; forward-only migration `0006_auth_verification_id_default.sql` adds it and the integration suite asserts it. One earlier browser run had a late connection reset and a retry that reused modified MFA state; remote confirmation is still required. Prisma tenant schema validation passed, the production dependency audit found no known vulnerabilities, and pinned Gitleaks v8.30.0 found no leaks in the scanned source and documentation.
- The user reported CodeQL and the secret scan passing in GitHub Actions. The updated quality workflow still needs a remote rerun after this fix; its result must be recorded before marking Phase 2 complete.

### Identity and tenant authentication

- [x] Add tenant-local authentication users with explicit `INVITED`, `ACTIVE`, `SUSPENDED`, and `DISABLED` states; keep authentication identity separate from optional staff, instructor, and participant profiles.
- [x] Keep users, roles, sessions, and permissions inside each tenant database; resolve trusted host/tenant context before authentication and never search tenants by email or another untrusted identifier.
- [x] Implement hostname-aware tenant sign-in with Argon2id, server-managed tenant-bound sessions, secure cookies, session rotation, logout revocation, throttling, generic errors, and CSRF/origin protection.
- [x] Verify tenant and user status on protected requests; reject forged or wrong-tenant sessions, revoke suspended/disabled access, and refresh or invalidate authorization state after critical account/role changes.
- [x] Implement tenant-bound, expiring, single-use invitations with random tokens hashed at rest, safe development/test delivery, replay and wrong-host rejection, and create/accept/revoke audit events.
- [x] Provide staff management for listing, inviting/creating, editing, role assignment, suspension/reactivation, status, and role assignment inspection without exposing credential or session secrets.
- [x] Add linked instructor and participant profile foundations and permission-protected tenant portal shells; do not add their Phase 3 business workflows.
- [x] Provision the initial tenant administrator through a safe owner onboarding flow and assign the Organization Owner role with explicit grants for the permission catalog.

### Tenant-local RBAC and authorization

- [x] Add normalized tenant-local `User`, `Role`, `Permission`, `UserRole`, and `RolePermission` relations with database constraints and support multiple roles per user.
- [x] Seed the specified permission catalog and default roles idempotently for new tenants and existing tenants; preserve Phase 1 role-template compatibility or migrate it safely.
- [x] Implement reusable centralized default-deny permission evaluation and contextual/object-level authorization hooks; derive effective permissions as a role union.
- [x] Enforce privilege-escalation limits when creating/editing roles, changing grants, assigning/removing roles, and modifying protected system roles; protect the last owner-level administrator.
- [x] Keep tenant RBAC and Platform Admin identity/authentication namespaces separate.
- [x] Authorize every tenant route, server action, use case, and page loader server-side; validate inputs with explicit allowed fields and generic safe errors.
- [x] Generate tenant navigation from tenant feature flags and effective permissions; add Persian-first RTL staff, role/permission matrix, instructor, participant, audit, settings, and safe empty-state UI.
- [x] Audit staff, role, permission, invitation, assignment, status, and session changes with tenant, actor, target, request ID, and timestamp while excluding secrets.

### Migration safety and documentation

- [x] Add a tenant Prisma schema and reviewed forward-only Prisma migrations for Phase 2 while preserving the existing Phase 1 SQL migration history and data.
- [x] Apply Phase 2 schema and idempotent RBAC seeds to new tenants during provisioning and provide a deterministic, repeatable upgrade path for already-provisioned Phase 1 tenants.
- [x] Document the migration/upgrade path, permission catalog and role model, security controls, threat model, tests, and Phase 2 scope in `docs/TENANCY.md`, `docs/RBAC.md`, `docs/SECURITY.md`, `docs/THREAT_MODEL.md`, and `docs/TESTING.md`.

### Required Phase 2 tests and quality gates

- [x] Add unit tests for permission union/default deny, escalation checks, protected-role rules, invitation token validation/expiry, user status, policy helpers, and tenant-bound session checks.
- [x] Add real-PostgreSQL tests for two-tenant identity/RBAC/session/invitation isolation, owner and least-privilege outcomes, escalation attacks, idempotent seeds/migrations, invite/assignment races, replay, revocation, suspension, and wrong-tenant requests.
- [x] Add Playwright flows for staff invitation and acceptance, custom role assignment and permitted navigation, direct API denial, suspended-session denial, cross-tenant denial, and participant/instructor portal access boundaries.
- [x] Re-run all Phase 1 tests and preserve their security guarantees.
- [x] Pass every configured static security scan. Gitleaks and CodeQL passed in GitHub Actions, as reported by the user.
- [ ] Pass formatting, lint, strict TypeScript, unit, real-PostgreSQL integration, Playwright E2E, production build, dependency audit, and secret scan in the updated GitHub quality workflow. Local reruns pass; remote confirmation is pending.
- [x] Review final changes for cross-tenant access, privilege escalation, session confusion, role/tenant tampering, mass assignment, IDOR, token leakage, enumeration, unsafe logs, CSRF, pool isolation, unsafe queries, and migration safety.

### Baseline before Phase 2 changes

- Phase 1 baseline passed before Phase 2 edits: `pnpm format`, `pnpm check`, `pnpm test:unit` (4 files/16 tests), `pnpm test:integration` (1 file/4 tests), `pnpm build`, `pnpm test:e2e:run` (1 browser test), production dependency audit, and pinned Gitleaks scan.
- The repository has no Prisma schema or migration history. Phase 1 tenant databases use the checksum-verified SQL runner and already-provisioned tenant databases must not be reset. Phase 2 migration tooling must explicitly bridge this baseline.
- Local Playwright used installed Chrome because the Playwright Chromium CDN returned HTTP 403. CI installs pinned Playwright Chromium. No `.git` metadata is available for a Git diff or remote CI run.
