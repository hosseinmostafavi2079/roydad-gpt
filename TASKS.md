# Phase 1 — Platform Foundation

## Phase 4 — Public tenant product (in progress)

Acceptance requires a tenant-scoped Persian public site, configurable safe profile/theme, published event listing/detail, participant registration and password/email-OTP login, transaction-safe enrollment/waitlist, participant account, organizer enrollment management, validated registration forms, server-enforced features/limits, real usage metrics, verified domain routing, public SEO, forward-only migrations, tenant-isolation/security tests, Docker compatibility, and the full local and GitHub gates. Phase 5 is out of scope. Do not mark this phase complete until every acceptance item and GitHub Actions pass.

This file preserves the Phase 1 and Phase 2 acceptance records and tracks the Phase 3 local gate below. Do not begin Phase 4.

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
- [x] Pass formatting, lint, strict TypeScript, unit, real-PostgreSQL integration, Playwright E2E, production build, dependency audit, and secret scan in the Phase 2 GitHub quality workflow, as reported by the user before Phase 3 began.
- [x] Review final changes for cross-tenant access, privilege escalation, session confusion, role/tenant tampering, mass assignment, IDOR, token leakage, enumeration, unsafe logs, CSRF, pool isolation, unsafe queries, and migration safety.

### Baseline before Phase 2 changes

- Phase 1 baseline passed before Phase 2 edits: `pnpm format`, `pnpm check`, `pnpm test:unit` (4 files/16 tests), `pnpm test:integration` (1 file/4 tests), `pnpm build`, `pnpm test:e2e:run` (1 browser test), production dependency audit, and pinned Gitleaks scan.
- The repository has no Prisma schema or migration history. Phase 1 tenant databases use the checksum-verified SQL runner and already-provisioned tenant databases must not be reset. Phase 2 migration tooling must explicitly bridge this baseline.
- Local Playwright used installed Chrome because the Playwright Chromium CDN returned HTTP 403. CI installs pinned Playwright Chromium. No `.git` metadata is available for a Git diff or remote CI run.
# Phase 3 — Program core (local gate in progress)

- [x] Add forward-only tenant migration for programs, runs, sessions, instructor assignments, venues, and rooms; upgrade existing tenants and provision new tenants at version `0003_phase3_program_core`.
- [x] Add tenant-scoped CRUD, controlled publishing transitions, audit events, permission checks, and instructor object access.
- [x] Prevent concurrent room/instructor overlaps with a tenant-scoped PostgreSQL transaction advisory lock; validate timezones and room capacity.
- [x] Add Persian RTL management pages, instructor-scoped run/session/calendar views, and real Phase 3 dashboard data.
- [x] Add guarded, idempotent local demo setup and explicit demo reset; ignore generated credentials.
- [x] Add focused unit, real PostgreSQL integration, and Playwright coverage for the new flows.
- [x] Complete the local Phase 3 gate: format, lint, type-check, 36 unit tests, 9 real PostgreSQL integration tests, production build, 1 Playwright browser flow, Prisma validation, production dependency audit, and Gitleaks.
- [ ] Confirm the updated GitHub Actions workflow is green before declaring Phase 3 complete.

Pricing, payments, attendance, and certificates remain deferred.

# Phase 4 — Public tenant product (in progress)

- [x] Add tenant public profile/theme, public home/about/contact/event pages, participant registration, password and email OTP login, enrollment with transactional capacity and waitlist, organizer registration list, form schema, feature flags, usage counts, and SEO foundations.
- [x] Add forward-only tenant migrations `0004`–`0006`; upgrade existing tenants in place. Add test coverage for self-registration, OTP tenant binding/replay, and concurrent capacity.
- [x] Expand the local demo seed with public profile content and a full waitlisted event.
- [ ] Complete tenant-admin custom-domain management and verification status UI; expand public filters and participant account calendar/profile/security views.
- [ ] Add full Phase 4 browser flow, including self-registration, OTP, enrollment, waitlist, organizer management, and Super Admin feature-toggle denial.
- [ ] Add email usage metering, enforce remaining measurable limits, and complete Phase 4 security/mobile tests and documentation.
- [ ] Pass the full local gate and confirm GitHub Actions is green before marking Phase 4 complete.

# Requested Phase 5 — Attendance and certificate foundation (local implementation; GitHub gate pending)

The project brief calls commerce Phase 5 and operations Phase 6. This request explicitly schedules attendance and certificates now and defers payments. Existing `attendance`, `qr_attendance`, and `certificates` plan/tenant feature keys remain the canonical server-side flags; their enabled values provide the requested attendance and certificate switches without a duplicate source of truth.

## Acceptance criteria

- [x] Add forward-only tenant migrations and Prisma models for one tenant-scoped attendance record per participant/session, replay-safe QR challenges, certificate templates, and certificates with unique serial and verification codes.
- [x] Enforce attendance and certificate permissions, assigned-session instructor scope, participant self-access, eligibility, feature flags, and tenant scope in services and routes.
- [x] Provide Persian RTL attendance marking, bulk actions, reports, CSV export, participant attendance, and signed short-lived QR check-in.
- [x] Provide controlled certificate templates, validated template background uploads, auditable issue/revoke operations, Persian PDF generation to private S3-compatible storage, authorized PDF download, and minimal public verification.
- [x] Show tenant-scoped attendance/certificate/PDF usage to Platform Super Admin and hide disabled tenant navigation.
- [x] Cover permission denial, tenant separation, QR expiry/replay, attendance transactions, certificate eligibility/idempotency/revocation/privacy, and migration upgrade with unit, real PostgreSQL integration, and Playwright tests.
- [x] Pass focused tests, `pnpm check`, all unit and integration tests, Prisma validation, production build, and Playwright; review security and update architecture, RBAC, threat model, and testing documentation.

Local gate: `pnpm check` passed (11 pre-existing lint advisories); 43/43 unit tests, 11/11 real PostgreSQL integration tests, production build, Linux Docker image build and healthy app startup, 2/2 Playwright tests, Prisma validation, production dependency audit, and pinned Gitleaks source scan passed. GitHub Actions has not run on this patch, so Phase 5 remains open.

Do not start payments or other Phase 6 work. Do not mark this requested phase complete until local gates and GitHub Actions pass.

# Phase 6 — Payment architecture (in progress)

The subsequent payment-architecture request authorizes work on payments. Phase 5's local implementation record above remains unchanged; GitHub confirmation is still required. Do not mark Phase 6 complete yet.

- [x] Add a provider-neutral contract, central registry, capability checks, TEST adapter limited to local/CI, and a second fake-adapter unit test.
- [x] Add forward-only financial schema with price snapshots, attempts, provider identifiers, coupons, invoices, refunds, encrypted provider configuration, and platform provider allowlist.
- [x] Add paid enrollment reservation, server-authoritative payment initialization, verified callback handling, idempotent invoice issuance, refund method records, and reconciliation primitives.
- [x] Add tenant-scoped coupon issuance, transactional reservation/redemption, bounded usage under concurrent checkout, and discount snapshots.
- [x] Add a generic webhook ingestion route with adapter signature-verification contract and event IDs; the installed TEST adapter does not use webhooks.
- [x] Schedule bounded, tenant-scoped reconciliation with capability checks, backoff, and idempotent settlement; expire unpaid reservations and release capacity/coupons safely.
- [x] Complete platform/tenant payment configuration and operator finance UI, participant payment status/invoices, and refund management.
- [x] Add real-PostgreSQL payment attempt failure/retry, verified success, duplicate callback, invoice, API refund, tenant isolation, and coupon concurrency tests.
- [x] Add browser coverage for free/paid enrollment, coupons, provider administration, failure/pending/expiration, duplicate callback, finance/refund, participant isolation, and amount tampering.
- [ ] Pass full local gates and GitHub Actions before enabling production payments or marking Phase 6 complete.

Local architecture gate so far: after the final webhook change, `pnpm check` passed with 11 pre-existing lint advisories; unit tests passed 46/46; real PostgreSQL integration passed 14/14; the production build and Prisma validation passed. Five existing local tenant databases upgraded through `0010_phase6_coupon_reservations`, and a repeat migration run was idempotent. The production dependency audit found no known vulnerabilities. Pinned Gitleaks found no leaks in `src`, `prisma`, `scripts`, `tests`, and `docs`. Playwright passed 2/2 earlier during this implementation, before the final coupon/webhook edits; a later rerun was blocked because the local app and a separate `next dev` process occupied port 3000. GitHub Actions has not run on this payment patch.

Final local Phase 6 gate: `pnpm check` passed with 11 pre-existing lint advisories; unit tests passed 47/47; real PostgreSQL integration tests passed 15/15 after updating migration count assertions for `0011_phase6_payment_lifecycle`; the production build, Prisma validation, and Compose configuration passed; final Playwright passed 2/2, including free/paid enrollment, coupons, payment outcomes, expiration, duplicate callback, finance/refund, participant isolation, and tampering rejection. The production dependency audit found no known vulnerabilities. Pinned Gitleaks found no leaks in `src`, `prisma`, `scripts`, `tests`, `docs`, `compose.yaml`, `package.json`, `playwright.config.ts`, and `TASKS.md`. GitHub Actions has not run on this uncommitted payment patch, so Phase 6 remains open.

# Pilot Step 1 — Registration and login UX (in progress)

- [x] Preserve a strict local event destination through password login, email OTP, and account registration.
- [x] Add tenant-host-bound Google sign-in with exact configured callback origins and verified-email account linking through Better Auth.
- [x] Add a Persian password/OTP/Google sign-in page, six-digit OTP entry and resend cooldown, and participant dashboard sections gated by features.
- [x] Pass focused browser, mobile, and verified-linking scenarios and the local code, database, build, and Playwright gates.
- [x] Complete the local Gitleaks scan.
- [ ] Confirm the GitHub Actions quality gate after pushing before marking this pilot complete.

Pilot Step 1 local result: focused Playwright passed 1/1; the full run passed 2/2. Unit tests passed 49/49 and real PostgreSQL integration tests passed 15/15. `pnpm check`, `pnpm build`, Prisma tenant schema validation, and the production dependency audit passed. The local Docker daemon stopped responding during its Gitleaks attempt; the official Gitleaks v8.30.0 Windows archive was verified against its published SHA-256 and scanned all 334 tracked and new files with no leaks. GitHub Actions has not run on this patch.

Pilot Step 1 follow-up: unified branded tenant login and registration at `/login`, role-aware server landing, explicit default-off `google_login` feature enforced at OAuth endpoints, documented local/production Google configuration, split Playwright journey into seven bounded named phases, and retained an independent platform auth spec. Focused five-phase browser run passed. Final local gates passed: `pnpm check`, 51/51 unit, 15/15 real PostgreSQL integration, production build, 8/8 Playwright, Prisma validation, production dependency audit, and Gitleaks v8.30.0 on 338 tracked and new files with no leaks. GitHub Actions remains pending for this follow-up.

# Pilot Step 2 — Platform tenant creation (GitHub gate pending)

- [x] Four-step Persian RTL creation wizard: four basic required fields, optional legal name/logo, color/preset, human-readable plan and disclosed overrides, review.
- [x] Authenticated slug availability preflight with database uniqueness as the final authority.
- [x] Persist a UUID creation key and payload hash; concurrent identical submissions return one tenant/job and conflicting key reuse fails.
- [x] Keep provisioning in the existing transactional queue/worker with safe retry and audited transitions.
- [x] Seed the public website name, theme, sections and placeholder; verify control, database, migration, RBAC, owner invitation, domain and site records; probe public home/login.
- [x] Display real progress, safe failure details, retry, health, success actions, and list filters.
- [x] Add focused unit/PostgreSQL checks and expand Playwright for mobile, site/login and optional logo.
- [x] Pass the full local gate: `pnpm check` (11 existing lint advisories), 56/56 unit tests, 16/16 real PostgreSQL integration tests, production build, 9/9 Playwright tests, Prisma validation, production dependency audit with no known vulnerabilities, and Gitleaks v8.30.0 across ten project targets with no leaks.
- [ ] Confirm GitHub Actions after pushing before marking Pilot Step 2 complete.

Final migration-aware local rerun passed: `pnpm check`, 56/56 unit, 16/16 real PostgreSQL integration, production build, and 9/9 Playwright. The first final browser attempt stalled on platform sign-out after Chrome reported `net::ERR_NETWORK_CHANGED`; a complete rerun passed including sign-out and teardown. Prisma validation, dependency audit, and Gitleaks passed earlier in this patch and are rerun for the final files. GitHub Actions has not run on this uncommitted change.

# Pilot Step 3 — Tenant public sites and instructor profiles (local gate in progress)

- [x] Add controlled website templates, design tokens, navigation and homepage section ordering, public event discovery and richer event details.
- [x] Add structured FAQ, testimonials, gallery, information pages and safe text/list/CTA blocks with tenant-scoped writes.
- [x] Separate explicitly published instructor profiles and optional PDF resumes from private staff accounts; add directory, profile editor, public pages and event summaries.
- [x] Add tenant, event and instructor SEO metadata with local canonical paths and Organization/Event/Person structured data.
- [x] Apply forward-only tenant migrations `0012_pilot_public_site` and `0013_pilot_public_seo`; preserve existing website settings through normalization.
- [x] Pass focused unit (6/6), PostgreSQL (1/1) and first three browser phases (3/3) during implementation.
- [x] Pass the final local code, unit, PostgreSQL, build, Playwright, Prisma, audit and Gitleaks gate on the final files.
- [ ] Confirm GitHub Actions after pushing. Do not mark the step complete before that gate.

Website settings use atomic validated saves. Information pages and public instructor profiles have draft/published state; a separate draft revision and publish action for the entire website was deferred because changing existing website profile persistence would broaden the tenant configuration path. Editors must save website changes to preview them publicly.

Final local gate: `pnpm check` passed with 24 lint advisories, 62/62 unit tests, 16/16 real PostgreSQL integration tests, production build, 9/9 Playwright tests, Prisma tenant schema validation, production dependency audit with no known vulnerabilities, and Gitleaks v8.30.0 across 11 project targets with no leaks. The first integration pass caught two stale migration-version assumptions; both were corrected and the full integration suite passed. GitHub Actions has not run on this uncommitted step.
# Pilot Step 4 — production deployment foundation (local validation pending)

- [x] Prepare a separate production Compose stack with private PostgreSQL, non-root app/worker, Caddy HTTPS and external S3 configuration.
- [x] Add explicit production preflight, read-only smoke checks, one-time administrator bootstrap, PostgreSQL backup script and manual deployment/restore/rollback guide.
- [x] Preserve production mode guards for SMTP, test payment/Google providers, trusted hostname routing and secure proxy origin handling.
- [ ] Build and run the production image and Caddy locally, then complete the full local gate. The Docker Desktop service is stopped on this Windows host and could not be started by the current user.
- [ ] Confirm GitHub Actions after pushing before marking Pilot Step 4 complete.

Local status after the provisioning isolation fix: the focused integration case passed 5/5 consecutive runs, and the full PostgreSQL suite passed 16/16. The worker's integration-only public probe now targets a reserved unreachable local endpoint, avoiding the unrelated app on port 3000 that opened two tenant pool sessions. A post-suite check found zero tenant pool sessions. `pnpm check`, unit tests 67/67, production build, Playwright 9/9 with installed Chrome, Prisma tenant schema validation, production Compose syntax, preflight, read-only local smoke, pinned Gitleaks v8.30.0 across 11 source/config targets, and the production dependency audit passed. Docker Desktop is still stopped and the daemon pipe inaccessible, so the image, Caddy container, production-like stack, container smoke and disposable-container backup verification remain unvalidated. GitHub Actions must pass after push before this step is complete.

Final pilot release-candidate audit: production preflight now rejects the committed template's documentation domains, sample SMTP/storage credentials and repeated-character application secrets. Focused deployment tests passed 6/6. The final non-container gate passed: `pnpm check` (24 existing image advisories), unit 68/68, PostgreSQL integration 16/16, production build, Playwright 9/9, Prisma validation, production dependency audit with no known vulnerabilities, Gitleaks across 11 targets, and `git diff --check`. A synthetic ignored production configuration passed preflight and Compose parsing. Docker Desktop remains stopped and its daemon pipe inaccessible; production image, Caddy, container health, container smoke, disposable tenant provisioning, backup and restore cannot be accepted. The current patch also awaits both GitHub workflows after push. Do not mark this release ready.

## Identity V2 — SMS providers and configurable profiles

- [x] Provider-neutral registry and first Kavenegar VerifyLookup adapter; typed encrypted configuration and platform allowance.
- [x] Official Better Auth phone and username plugins, canonical Iranian phones, tenant uniqueness and OTP-only phone changes.
- [x] Tenant method configuration and administrator recovery; existing email/Google flows retained.
- [x] Bounded participant profile builder, protected identity fields and private staff views.
- [x] Focused unit and real PostgreSQL identity checks before full gates.
- [x] Full local release gate and browser validation completed.
- [ ] GitHub Actions green for the pushed Identity V2 commit.

No custom-domain, deployment, payment, attendance or certificate feature work is included.

Identity V2 final local results: pnpm check passed (93 warnings and 3 informational diagnostics; no errors), unit tests 93/93 across 17 files, real PostgreSQL integration tests 30/30 across 3 files, production build succeeded, Playwright 10/10 including teardown, Prisma tenant validation passed, and dependency audit found no known vulnerabilities. Focused identity PostgreSQL tests passed 14/14 before the final gate. The final Gitleaks working-tree scan is recorded in docs/TESTING.md. Two initial full browser attempts failed on the existing public provisioning probe (fetch TypeError before any HTTP status); its focused rerun and the final full suite passed without changing the probe, health assertion or timeouts. GitHub Actions has not run on this uncommitted change; completion remains pending its quality gate.

## B1 — Custom domain core and security

- [x] Reuse tenant_domains, its globally unique hostname and partial unique primary index; no new domain system or migration.
- [x] Reserve the configured platform hostname; preserve local platform subdomains and independent tenant parent domains.
- [x] Add expiring TXT challenge rotation, a bounded injectable DNS resolver and stale-proof rejection.
- [x] Add authorized transactional primary switch and safe deletion with audit and resolver invalidation.
- [x] Recheck domain ownership on cache hits across application processes; preserve tenant-auth origins and same-origin checks.
- [x] Run final pnpm check, focused unit/PostgreSQL tests, Prisma validation and git diff --check.

B2 UI, B3 full browser/build/release gates and deployment work are outside B1.

B1 final local result: pnpm check passed (93 warnings, 3 informational diagnostics, no errors); focused units 22/22 across 3 files; focused real PostgreSQL 12/12; Prisma validation and git diff --check passed. Zero migrations. Full browser/build/deployment/GitHub gates remain B3 work.

## B2 — Custom domain management UI

- [x] Replace the technical domain form with a dedicated full-width Persian domain section, cards and semantic ownership/primary badges.
- [x] Add accessible add/DNS/primary/delete dialogs consuming B1 APIs; retain verification values only in component memory, with explicit clipboard actions and status feedback.
- [x] Add an optional wizard hostname handoff; register via existing API on tenant details without making DNS a provisioning dependency. Failed registration remains visible and retryable.
- [x] Retain verified primary hostnames in tenant summaries; do not change backend, resolver, auth, SMS or migrations.
- [x] Complete final focused checks and visual review at 390/1440.

Full PostgreSQL/browser regression, deployment and release gates belong to B3.

B2 final local result: pnpm check passed with 94 warnings and 3 informational diagnostics (no errors); focused units 16/16 across 2 files; focused Playwright 1/1 covering all six requested flows and wizard handoff; production build succeeded for the production-mode browser server; git diff --check passed. Seven screenshots were visually inspected. No full regression, real DNS, migration or deployment work was performed.

## B3 — Identity and custom-domain release regression gate

- [x] Replace the identity integration resolver mock with real control-plane domain/registry/branding fixtures and matching feature/limit overrides.
- [x] Exercise verified custom Host login-page branding, SMS registration, username login, host-only cookies, event continuation, cross-tenant session rejection and primary switching without real DNS or external SMS.
- [x] Review tenant/host/origin boundaries, domain ownership, SMS secrets/OTP logs and profile PII authorization; no application regression requiring a production-code change was found.
- [x] Run the full local gate once: check; 114 unit tests; 43 PostgreSQL integration tests; production build; 11 Playwright tests; Prisma validation; production dependency audit; Gitleaks; diff check.

Clean provisioning and the existing forward upgrade/idempotency tests passed through `0014_identity_v2`. No migrations, reset, deployment or feature changes. The starting commit had successful GitHub Quality Gates and CodeQL runs; the B3 commit must independently pass both before release approval.
