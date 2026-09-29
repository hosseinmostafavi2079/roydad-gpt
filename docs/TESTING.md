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

## Provisioning worker readiness regression

The GitHub Actions quality job uses `LOG_LEVEL=warn`. The provisioning worker registered its PostgreSQL queue subscription and then wrote `logger.info("Provisioning worker started")`; Pino suppresses that line at `warn`. Both the real-PostgreSQL integration test and Playwright previously treated the log line as readiness, so the integration test reported `Provisioning worker did not start` after 20 seconds even though the worker could be running. Local development normally used `info`, which hid this mismatch. This was a test orchestration failure, not evidence of slow worker startup; the timeout has not been increased.

The worker now sends `eventos.provisioning.ready` over Node's IPC channel only after `getProvisioningBoss()` and `boss.work(...)` complete. The integration and Playwright launchers create that channel and wait for the message, with their spawned worker's `LOG_LEVEL` fixed at `warn` so local runs exercise CI's logging behavior. If spawn, queue initialization, or registration fails, the test includes process exit/spawn details and captured stderr/stdout in the failure, with database credentials redacted. The existing 20-second timeout still detects a stuck startup. The worker's normal process mode remains available when no IPC parent exists.

## Local and CI dependencies

Integration and E2E tests require disposable PostgreSQL. The integration suite applies control migrations idempotently, provisions independent tenant databases, injects a safe provisioning failure, retries, races duplicate provisioning, migrates a Phase 1 tenant in place, and validates identity/RBAC operations on real PostgreSQL. It uses a mocked DNS TXT answer only for domain ownership proof; tenant resolution, registry writes, migrations, auth data, and database isolation still use real PostgreSQL.

Playwright installs its pinned Chromium build by default. If the browser archive is unavailable locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome executable for local runs; CI installs and uses pinned Playwright Chromium. The test-only Node preload records the standalone server PID. Teardown removes ephemeral test data and stops only that PID; on Windows it terminates the recorded server because Playwright cannot deliver graceful shutdown signals there.

CI runs formatting, lint, strict type-checking, unit and real-PostgreSQL integration tests, a production build, Playwright Chromium flows, dependency auditing, Gitleaks, and CodeQL. No container is built in this phase, so container scanning is not configured.
