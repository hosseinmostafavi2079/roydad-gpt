# Testing strategy

Tests are release gates, not optional follow-up. Use deterministic synthetic identities and disposable PostgreSQL databases. Mock databases do not establish migration or database-isolation correctness.

## Phase 1 and Phase 2 matrix

| Area | Test | Level |
|---|---|---|
| Configuration | Missing/invalid production secrets, URLs, and MFA settings fail startup safely | Unit/integration |
| Platform auth | Argon2id hashes, no public admin registration, MFA requirement, throttling, generic error handling | Unit/integration/E2E |
| Request security | Unauthenticated denials, same-origin/CSRF rejection, session revocation, request-ID errors and safe logs | Unit/integration/E2E |
| Tenant resolution | Case/trailing-dot normalization, exact verified domain, active status, unknown/unverified/malformed host rejection | Unit/real PostgreSQL |
| Tenant database | Tenant A/B contexts, databases, pools and concurrent requests remain isolated | Real PostgreSQL integration |
| Provisioning | Successful seed/activation, retry after injected failure, duplicate delivery race, one active transition and migration idempotence | Real PostgreSQL integration/E2E |
| Schema bridge | Existing Phase 1 tenant upgrades without reset, registers recognized migration history, and a repeat run adds no duplicate migration audit | Real PostgreSQL integration |
| Identity | Invite/accept, hash-only token storage, expiry, replay rejection, duplicate invite race, single-use acceptance race | Unit/real PostgreSQL/E2E |
| Authentication | Tenant-local login, generic invalid login, rate limiting, tenant-bound session, logout, suspension/disable rejection | Unit/real PostgreSQL/E2E |
| RBAC | Multi-role union, default deny, owner explicit grants, least privilege, unauthorized grant/assignment denial, immutable roles, last-owner guard and fresh grants | Unit/real PostgreSQL/E2E |
| Profiles and APIs | Staff/instructor/participant invitation and profile shells; strict allow-lists, direct API authorization denial | Real PostgreSQL/E2E |
| Audit | Sensitive role, grant, assignment, status, invitation, session events recorded without secrets | Real PostgreSQL integration |
| UI | Persian RTL, accessible labels, permission-filtered navigation and safe empty states | Playwright/manual review |

Phase 2 unit policy tests cover permission unions/default-deny, role-grant escalation, protected roles and owner grants, token shape/expiry/consumption, status eligibility, tenant-bound sessions, contextual resource authorization, and mass-assignment rejection. Integration tests use two independently provisioned PostgreSQL tenant databases and exercise migration, invitation, session, grant, race, audit, status, role, API, and cross-tenant boundaries.

The Playwright suite runs the production-built standalone server with production cookie/configuration behavior. Its explicitly PID-tracked local E2E server uses a private temporary invitation outbox instead of connecting to real SMTP; regular production processes do not set the E2E marker and require TLS SMTP. The browser flow retains platform admin MFA, tenant provisioning failure/retry, settings, and logout checks; it additionally accepts owner/staff/instructor/participant invitations, creates and assigns a custom least-privilege role, checks grouped/high-risk permission controls and permitted/hidden navigation, checks direct role API denial and active-session rejection after suspension, verifies portal/admin boundaries, and rejects a Tenant A session and invitation on Tenant B. Attendance and finance are seeded future permission modules; their business routes are intentionally absent until Phase 3. RBAC grants and denials for those permissions are covered at policy/integration level rather than by introducing Phase 3 endpoints.

## Required commands

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e:run
pnpm audit:deps
```

Also validate Prisma tenant schema with the pinned local Prisma CLI and run the pinned Gitleaks scan. CI runs CodeQL for JavaScript/TypeScript. Run every gate after the final implementation changes; do not infer a pass from CI configuration.

CodeQL is configured in `.github/workflows/codeql.yml` and has passed in GitHub Actions, as reported by the user. The Phase 2 quality gate remains open until the updated `.github/workflows/ci.yml` run passes.

## Invitation mail providers in tests

CI exports `NODE_ENV=development` for migrations and administrator seeding. Vitest previously inherited that value, so the invitation mailer chose SMTP instead of its private test outbox and failed because CI correctly leaves `SMTP_URL` empty. `vitest.config.ts` now sets `MAIL_TRANSPORT=test` inside the test runner; `NODE_ENV=test` remains scoped to Vitest for other test-only behavior and does not choose the mail provider. Run the integration suite with a parent `NODE_ENV=development` and `MAIL_TRANSPORT=smtp` to reproduce CI's environment and verify the isolation.

Invitation delivery composes one recipient, subject, text, and HTML message before passing it to an SMTP provider or the test outbox provider. `MAIL_TRANSPORT` defaults to `smtp`; `test` is rejected in production except for the explicitly preloaded Playwright server. The outbox records the complete message in a mode-0600 temporary file because Playwright's standalone server and test process do not share memory. Integration and Playwright read the captured message to verify recipient, link, hashed-at-rest token, one-time acceptance, and wrong-tenant rejection. No test message is exposed through an application route. An ordinary production process uses SMTP and configuration rejects missing or non-TLS SMTP.

## Production build environment regression

The CI job exports `NODE_ENV=development` for its setup steps. Running the old `next build` command under that inherited value reproduced the GitHub failure locally: Next warned about the environment, React reported missing keys in generated viewport/head boundaries, and `/_global-error` prerender failed with `useContext` on null. With `NODE_ENV=production`, the unchanged application built successfully with none of those warnings. React and React DOM are both pinned to 19.2.8, and the application has no custom global error component. The warnings did not originate from application list rendering, so no UI key changes were needed.

`pnpm build` now runs `scripts/build.mjs`, which launches Next with `NODE_ENV=production` and `MAIL_TRANSPORT=smtp` regardless of its parent shell. The GitHub production-build step also sets those values explicitly without changing the job-wide development configuration. Playwright starts its production-built standalone server with an explicit test mail transport and the validated private preload.

During the local browser rerun, Better Auth attempted to insert a platform verification without an ID. The existing `platform_auth_verifications.id` column had no database default, unlike the other authentication ID columns. Forward-only control migration `0006_auth_verification_id_default.sql` adds a UUID-text default; the PostgreSQL suite verifies the migration and column default. The browser flow passed on a clean rerun. One earlier local run had a connection reset late in the flow; its retry reused the already-mutated administrator and failed sign-in, so that attempt is not counted as a pass.

## Provisioning worker readiness regression

The GitHub Actions quality job uses `LOG_LEVEL=warn`. The provisioning worker registered its PostgreSQL queue subscription and then wrote `logger.info("Provisioning worker started")`; Pino suppresses that line at `warn`. Both the real-PostgreSQL integration test and Playwright previously treated the log line as readiness, so the integration test reported `Provisioning worker did not start` after 20 seconds even though the worker could be running. Local development normally used `info`, which hid this mismatch. This was a test orchestration failure, not evidence of slow worker startup; the timeout has not been increased.

The worker now sends `eventos.provisioning.ready` over Node's IPC channel only after `getProvisioningBoss()` and `boss.work(...)` complete. The integration and Playwright launchers create that channel and wait for the message, with their spawned worker's `LOG_LEVEL` fixed at `warn` so local runs exercise CI's logging behavior. If spawn, queue initialization, or registration fails, the test includes process exit/spawn details and captured stderr/stdout in the failure, with database credentials redacted. The existing 20-second timeout still detects a stuck startup. The worker's normal process mode remains available when no IPC parent exists.

## Local and CI dependencies

Organization UI and media verification uses real PostgreSQL plus Adobe S3Mock (`adobe/s3mock:5.1.0`) as the local S3-compatible service. `pnpm local:setup` provisions both locally; CI starts the same pinned S3Mock image. The integration runner executes its database suites serially because each suite creates and drops tenant databases and closes its pools during teardown. Unit tests cover Persian built-in role labels, Jalali conversion boundaries, and media validation. Integration tests cover media upload, download, deletion, and wrong-tenant access. Playwright covers owner login, cover/logo upload, public rendering, section toggles, grouped navigation, and mobile layout. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e:run`, and Prisma validation before release.

Integration and E2E tests require disposable PostgreSQL. The integration suite applies control migrations idempotently, provisions independent tenant databases, injects a safe provisioning failure, retries, races duplicate provisioning, migrates a Phase 1 tenant in place, and validates identity/RBAC operations on real PostgreSQL. It uses a mocked DNS TXT answer only for domain ownership proof; tenant resolution, registry writes, migrations, auth data, and database isolation still use real PostgreSQL.

Playwright installs its pinned Chromium build by default. If the browser archive is unavailable locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome executable for local runs; CI installs and uses pinned Playwright Chromium. The test-only Node preload records the standalone server PID. Teardown removes ephemeral test data and stops only that PID; on Windows it terminates the recorded server because Playwright cannot deliver graceful shutdown signals there.

CI runs formatting, lint, strict type-checking, unit and real-PostgreSQL integration tests, a production build, Playwright Chromium flows, dependency auditing, Gitleaks, and CodeQL. No container is built in this phase, so container scanning is not configured.
## Phase 3 verification

Focused tests: `tests/unit/program-core.test.ts` covers state transitions, input and time validation, overlap, timezone conversion, and instructor object access. `tests/integration/program-core.test.ts` uses disposable real PostgreSQL tenant databases to cover migration, program/run/session writes, auditing, capacity, instructor and room conflict checks, concurrent scheduling, instructor scope, and cross-tenant identifiers. `tests/e2e/platform-admin.spec.ts` extends the owner flow through Program, Run, Session, venue/room, publish, calendar, instructor isolation, and restricted direct API access. Use `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e:run`, Prisma validate, production dependency audit, and Gitleaks for the full local gate. Local Windows runs can set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the installed Chrome executable; CI installs pinned Playwright Chromium.

## Phase 4 work in progress

The real PostgreSQL integration suite now checks participant self-registration and email verification, OTP delivery/replay and cross-tenant rejection, and capacity-one concurrent enrollment with a confirmed seat plus waitlist. The schema advances through `0006_phase4_self_registration_ids` without resetting tenant databases. The existing browser flow also checks an anonymous tenant home, event list, and published event detail after organizer publishing. A dedicated registration, participant authentication/enrollment, waitlist, and feature-toggle browser flow remains required before release.

The Super Admin feature/limit API request bounds derive from their catalogs. Adding Phase 4 keys while retaining the previous fixed bounds caused the browser feature form to receive `VALIDATION_FAILED`; this was caught and fixed during the local browser run. The local demo has public about/contact content and an at-capacity waitlist event. `pnpm demo:setup` remains local only and stores generated credentials in ignored `.demo-credentials.local`.

## Requested Phase 5 verification

`tests/unit/phase-five.test.ts` checks QR signature tampering, tenant binding, expiry, check-in windows, attendance percentages, controlled certificate placeholders, and rendering a PDF with the installed Persian font. `tests/integration/program-core.test.ts` extends disposable PostgreSQL coverage to staff marking, batch rollback, permission denial, instructor scope, own attendance, QR replay, completed-run certificate eligibility, idempotent issue, private PDF bytes, wrong-tenant verification, and revocation. `tests/e2e/platform-admin.spec.ts` enables the attendance/QR/certificate features and runs admin marking/report, participant own attendance/certificate, certificate issuance, public verification, and revocation flows. All new tests use local PostgreSQL and the existing disposable S3-compatible test service, with no external email or storage dependency.

The first expanded browser run reached certificate issuance but the standalone server returned `ENOENT`: the source-tree PDF unit test could read the Persian font, while Next's standalone file trace omitted PDFKit's runtime font metrics. `next.config.ts` now includes the Vazirmatn WOFF in the certificate route trace and treats PDFKit as a server external package so its `.afm` resources are copied into the standalone output. The local build was inspected for both assets, and the expanded browser flow passed with certificate issuance and public verification/revocation.

Final local result for this patch: `pnpm check` passed with 11 pre-existing lint advisories; `pnpm test:unit` passed 43/43; `pnpm test:integration` passed 11/11; `pnpm build` succeeded; Playwright passed 2/2 using installed Chrome on Windows; Prisma schema validation passed; production dependency audit found no known vulnerabilities; and the CI-pinned Gitleaks image found no leaks in tracked and new source files. GitHub Actions remains unverified for this patch.

The Linux `docker compose build app` also passed after separating the standalone server from the full pnpm dependency tree in the runtime image. `docker compose up -d --no-deps app` recreated the local app, and both its health status and `/api/health/live` response passed. This image-layout change was needed because copying standalone-traced package directories and pnpm symlinks into the same `node_modules` path failed during Docker image assembly.

Local gate commands: `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e:run`, `node node_modules/prisma/build/index.js validate --schema prisma/tenant/schema.prisma`, `pnpm audit:deps`, and the pinned Gitleaks command from CI. The phase remains open until local and GitHub Actions gates are green.
# Phase 6 payment tests (work in progress)

`tests/unit/payment-provider.test.ts` registers a second fake adapter with non-TEST capabilities and checks creation, server verification, normalized status mapping, refund capability denial, amount mismatch rejection, production TEST rejection, and authenticated TEST verification. `tests/integration/program-core.test.ts` checks trusted server-side price snapshots, paid capacity reservation, concurrent coupon reservation, full-discount confirmation, attempt failure/retry, verified success, duplicate callback, invoice uniqueness, API refund, tenant isolation, reservation expiration, coupon release/reuse, late callback versus cleanup, capacity safety, and reconciliation backoff/idempotency after a provider outage. `tests/e2e/payment-flows.ts` extends the browser suite with free and paid enrollment, coupon use, verified success/failure/pending, expiration cleanup, duplicate callback, organizer finance/refund, own invoice/PDF, cross-participant access denial, and price tampering rejection. The final local run passed 47/47 unit, 15/15 real PostgreSQL integration, and 2/2 Playwright tests against a production build. `pnpm check`, Prisma validation, dependency audit, and the pinned Gitleaks scan passed. `EVENTOS_E2E_PORT` allows an isolated local port when 3000 is in use. The continuous worker and one-shot command are documented in `docs/PAYMENTS.md`. The Phase 6 GitHub gate remains pending until Actions runs on the committed change.

# Pilot Step 1 authentication journey

The public event form sends unauthenticated visitors to one Persian tenant login page with a validated local event destination. Password, email OTP, and Google return to that event after authentication; registration preserves the same destination through email verification. `tests/unit/pilot-auth.test.ts` checks strict local destinations and exact Google origin enablement. `tests/e2e/pilot-auth-flows.ts` covers event-to-password and event-to-OTP login, a provider-safe signed Google identity in the isolated E2E server, verified account linking without a duplicate participant, rejection of unverified linking, Google registration, malicious return paths, and 320/375/390/430/768 pixel layouts. The mock cannot be selected in ordinary production.

Pilot Step 1 local gates: focused Playwright passed 1/1; full Playwright passed 2/2; unit tests passed 49/49; real PostgreSQL integration tests passed 15/15. `pnpm check`, the production build, Prisma tenant schema validation, and `pnpm audit:deps` passed. The local Docker daemon became unresponsive during the pinned container scan, so the official Gitleaks v8.30.0 Windows archive was verified against its published SHA-256 and used to scan all 334 tracked and new files; no leaks were found. GitHub Actions remains unverified. The browser test polls the database-backed Better Auth rate-limit reset when a long run exhausts the configured sign-in budget; it does not bypass the limit.

Pilot Step 1 follow-up: tenant `/login` now hosts both login and registration modes in one branded shell; `/register` redirects to registration mode while preserving a validated event destination. The Google button and endpoint require both exact origin configuration and `google_login`. The focused browser run passed five named phases through pilot auth, including password, OTP, Google mock, verified linking, wrong return URL, role-aware landing, and hidden/denied Google when disabled. Historical Playwright coverage now runs as seven named serial phases over one disposable tenant fixture, plus an independent platform-auth spec, so a failure identifies its phase and no test has the former 600-second aggregate timeout. The final local gate passed: `pnpm check` (11 existing lint advisories), 51/51 unit, 15/15 real PostgreSQL integration, production build, 8/8 Playwright, Prisma tenant schema validation, production dependency audit with no known vulnerabilities, and Gitleaks v8.30.0 on 338 tracked and new files with no leaks. GitHub Actions has not run on this follow-up.

# Pilot Step 2 tenant creation

Unit tests cover slug suggestions, strict hostname/email input, required request idempotency key, visual defaults and real provisioning-state labels. The real PostgreSQL test races two identical creation requests, repeats one, rejects changed-payload key reuse, checks a single tenant/job, injects migration failure, retries, and verifies the owner invitation, RBAC, domain, registry, website profile and audit. The Playwright Super Admin flow exercises the four wizard steps, mobile widths, real failure/retry/activation, public home/login response and optional S3 logo upload. The create route remains protected by platform authentication and same-origin checks; availability is only a preflight hint.

The worker stores HEALTHY after database verification, marks DEGRADED when a bounded public home/login HTTP probe fails, and stores FAILED when provisioning fails. Legacy UNAVAILABLE rows remain recognized as failures. HTTP probes request the server-derived tenant origin, including the configured local port, and consume the response fully; they do not contain credentials. Local database-only integration runs may show DEGRADED because no web server is running. A real deployment needs a reachable tenant hostname for the HTTP probes. No full application test suite runs during provisioning.

Final local Pilot Step 2 result: `pnpm check` passed with 11 existing lint advisories; unit tests 56/56; real PostgreSQL integration tests 16/16; production build succeeded; Playwright passed 9/9 against the rebuilt standalone app on an isolated local port; Prisma schema validation passed; production dependency audit found no known vulnerabilities; the checksum-verified official Gitleaks v8.30.0 Windows binary found no leaks across source, tests, scripts, docs, workflow and root project files. The initial full Playwright run found one ambiguous new heading selector; that selector was corrected, its focused browser phase passed, and the final full run passed. GitHub Actions remains unverified until this patch is pushed.

After adding forward-only control migration `0010_tenant_health_failed`, the complete local gate passed again: 56/56 unit, 16/16 real PostgreSQL integration, production build, and 9/9 Playwright. One intermediate browser attempt timed out on the final platform sign-out after Chrome recorded `net::ERR_NETWORK_CHANGED` for the sign-out POST; a complete rerun passed that same sign-out, isolation assertion and teardown. The timeout was not resolved by increasing test limits or bypassing sign-out.

Final health-probe review replaced the localhost request with an overridden Host header with a request to the tenant origin itself and added an E2E assertion for HEALTHY plus its visible Persian status. The final gate passed: `pnpm check`, 56/56 unit, 16/16 real PostgreSQL integration, production build, and 9/9 Playwright. GitHub Actions still has to run on the pushed commit.

## Pilot Step 3 public website verification

`tests/unit/pilot-site-builder.test.ts` checks website defaults/ordering and safe URLs, custom page slugs/blocks, public instructor field mapping, and PDF/media validation. The real PostgreSQL `phase-one.test.ts` tenant journey checks FAQ and information page draft/publish behavior, instructor draft/publish and private-field separation, resume access and tenant isolation, and migration versions. The serial Playwright journey checks organization website editing and public output, instructor image/PDF publication and private email exclusion, event detail links, and widths 320/375/390/430/768/1024/1440 across the public pages.

Custom information page text supports headings, paragraphs, bold (`**text**`), italic (`*text*`), structured lists and local-path links (`[label](/events)`). Rendering uses React elements; executable HTML, external links in rich text, script, iframe and tenant CSS are not accepted. Website configuration is saved atomically after server validation. Pages and instructor profiles can stay draft; the whole website configuration has no separate draft snapshot, so preview reflects saved settings.

Final local Step 3 result: `pnpm check` passed with 24 lint advisories, unit tests 62/62, real PostgreSQL integration tests 16/16, production build, Playwright 9/9, Prisma tenant validation, `pnpm audit:deps` with no known vulnerabilities, and pinned Gitleaks v8.30.0 across 11 project targets with no leaks. GitHub Actions remains unverified until this change is pushed.
## Pilot Step 4 deployment checks

Run `pnpm deploy:preflight` with a private `.env.production` to validate deployment settings and Compose without changing data. `--check-db` is optional and queries each configured database with `SELECT 1`. The focused deployment unit tests exercise safe rejection and read-only smoke behavior. Before release, run the full code, unit, PostgreSQL integration, production build, Playwright, Prisma, dependency audit and Gitleaks gates, then `docker compose --env-file .env.production -f compose.production.yaml config --quiet`, build the production app image, validate the Caddyfile in its pinned container, and run a production-like local smoke test. The deployment image and proxy checks require a working Docker daemon.

The provisioning integration worker sets `EVENTOS_TEST_PUBLIC_PROBE_ORIGIN` to an unreachable loopback endpoint. This keeps its optional HTTP health probe from contacting an unrelated developer app on port 3000 and opening tenant pools that the test cannot close. Production workers do not set this test-only override. The provisioning assertion still waits for the persisted job state and verifies the tenant database, invitation and isolation; cleanup closes owned worker and pool resources before dropping disposable tenant databases.

## Identity V2 validation

Identity V2 adds official Better Auth phone/username plugins, a provider registry, tenant-scoped encrypted SMS configuration and configurable participant profiles. Focused tests run before the full release gate. Unit tests cover normalization, schemas, adapters and production transport rejection. PostgreSQL tests exercise real migrations, unique identifiers, OTP registration/expiry/attempts, phone changes, username sessions, field validation, tenant boundaries and secret redaction.

Playwright uses the production build and normal OTP verification. Its test-only process preload mocks the Kavenegar delivery HTTP boundary and captures messages in a restricted disposable file. It never selects the TEST adapter in production or bypasses OTP verification. The identity flow covers configured required profile fields, SMS signup, return to the same event, enrollment, username login, verified phone changes and disabled-method rejection, including 320/375/390/430/768 viewport checks.

Use `SMS_TRANSPORT=test` only for explicit local/test processes. Production must use `SMS_TRANSPORT=provider`. See SMS-PROVIDERS.md for configuration and security boundaries. Final gate results are recorded in TASKS.md after execution; GitHub must validate the pushed commit independently.

Final Identity V2 local gate: check passed, unit 93/93 (17 files), PostgreSQL 30/30 (3 files), production build passed, Playwright 10/10 against that production build, Prisma tenant schema valid, dependency audit with no known vulnerabilities. Run PostgreSQL integration and Playwright sequentially: both exercise the shared local provisioning queue and must own their workers independently. The initial public-probe browser failures did not receive a timeout increase or weaker health assertion; focused provisioning passed 2/2 and the final full browser run passed including teardown. GitHub Actions remains pending push.

Gitleaks v8.30.0 scanned all 435 tracked and new non-ignored source/configuration files (temporary test logs excluded), with redacted output: no leaks found. The source snapshot excludes private ignored environment and demo credential files.
