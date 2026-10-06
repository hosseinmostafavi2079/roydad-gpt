# Threat model

Last updated for Phase 2.

## Assets

- Control-plane tenant, plan, feature, limit, branding, domain, and provisioning metadata.
- Platform administrator credentials, sessions, MFA secrets, recovery material, and platform audit records.
- Tenant-local users, password credentials, sessions, invitations, profiles, roles, permissions, and audit records.
- Per-tenant PostgreSQL databases and the trusted mapping to database names.
- Provisioning, migration, control-plane, and tenant-runtime credentials; bootstrap encryption key.
- Domain verification tokens, authorization decisions, logs, and service health signals.

## Trust boundaries

- Browser ↔ Next.js server and authentication endpoints.
- Unauthenticated visitor ↔ platform administrator or tenant-user session.
- Platform administrator ↔ privileged control-plane operations.
- Tenant A ↔ Tenant B identities, role grants, invitation tokens, databases, domain mappings, cache entries, and pool handles.
- Tenant role/permission administration ↔ tenant user authority.
- Tenant-wide permission ↔ an individual future business resource/relationship.
- Application ↔ control PostgreSQL, tenant PostgreSQL, and provisioning connection.
- Web process ↔ provisioning worker/job queue.
- Platform subdomain/custom domain ↔ authoritative control-plane domain registry.

## Major threats

| Threat | Impact | Likelihood | Mitigation | Verification | Residual risk |
|---|---|---:|---|---|---|
| Admin credential theft or brute force | Platform takeover and tenant disruption | Medium | Argon2id, throttling, secure sessions, production TOTP MFA, no public admin signup | Auth integration/E2E, rate-limit test, MFA policy test | Recovery-channel compromise remains possible |
| Tenant account enumeration or password attack | Account discovery or takeover | Medium | Generic login errors, tenant-local host lookup, Argon2id, database-backed throttling | Real-PostgreSQL invalid-login and throttling tests | Email delivery/configuration can disclose that an invitation was sent to its recipient |
| CSRF, forged origin, or session fixation | Unauthorized mutations | Medium | Same-origin checks, trusted host resolution, SameSite/HTTP-only cookies, auth-library session rotation | Origin and cookie/session tests | Reverse-proxy misconfiguration can weaken origin signals |
| Forged or wrong-tenant session | Cross-tenant access | Medium | Session tenant claim checked against resolved tenant; tenant DB lookup is host-scoped; current account state is re-read | Cross-tenant session/API and Playwright tests | Application/library defect remains possible |
| Suspended user reuses session | Unauthorized account access | Medium | Re-check user status on each protected request; reject suspended/disabled/invited accounts | Integration and E2E status revocation tests | A compromised database could alter status and grants |
| Role/permission tampering or privilege escalation | Unauthorized administrative or financial access | Medium | Normalized tenant-scoped foreign keys, strict input schemas, actor-grant bounds, immutable system roles, last-owner invariant | Unit and PostgreSQL escalation tests, direct API denial E2E | Incorrect future permission checks can still grant excess authority |
| IDOR/BOLA on business records | Exposure or modification of another user's record | Medium | Tenant-local database routing, permission checks, and instructor assignment checks for runs/sessions | Unit, real PostgreSQL, and E2E cross-tenant/instructor tests | Enrollment objects remain deferred to Phase 4 |
| Invitation theft, replay, race, or wrong-host acceptance | Account takeover or duplicate identity | Medium | High-entropy token, hash at rest, 24-hour expiry, row lock and single-use transaction, tenant-bound lookup, generic failure | Unit and real-PostgreSQL replay/race/wrong-host tests | Compromised recipient mailbox can expose a live invite |
| Cross-tenant pool/cache reuse | Data corruption or disclosure | Medium | Trusted tenant context, immutable per-key DB mapping, bounded tenant pool cache, tenant-scoped invalidation | Concurrent A/B pool and resolution integration tests | Application/library defect remains possible |
| Provisioning retry/race or migration mismatch | Duplicate DB, partial schema, wrong status, data loss | Medium | Persistent state machine, generated database names, serialized upgrades, recognized baseline checks, verification before registry update | Concurrent provisioning and real existing-tenant upgrade/idempotency tests | Manual review may be required after infrastructure failure |
| SQL/database-name injection | Database privilege escalation or data loss | Low | Internal-ID-derived identifiers, identifier allow-list/quoting, parameterized values, separate provisioning role | Malicious tenant metadata tests and source review | A compromised high-privilege provisioner remains critical |
| Secret leakage through logs/errors or invitation delivery | Credential compromise | Medium | Structured logger redaction, safe error envelope, hash-only invite storage, encrypted owner bootstrap, temporary test outbox | Captured-log tests, source secret scan, token replay tests | Provider/proxy/email logs require separate retention policy |
| Malicious migration or excessive resource use | Outage or data loss | Medium | Reviewed additive migrations, locks, bounded pools/jobs/timeouts, disposable integration tests | Migration review and timeout/race tests | PostgreSQL/provider configuration varies by deployment |

## Deferred threat areas

Participant privacy workflows beyond current authenticated records and additional business-record authorization belong to later phases. Future features must add resource-specific authorization before exposing those records. Production controls also depend on deployment infrastructure, backup testing, secret management, monitoring, and recovery procedures.

## Attendance and certificate threat update

| Threat | Mitigation | Verification |
|---|---|---|
| Wrong-tenant or replayed QR | HMAC binds tenant/session/challenge/expiry; row lock, unique use, and unique attendance record reject repeat redemption | QR unit and real-PostgreSQL tests |
| Instructor reads unrelated attendance | Session assignment query in server repository; direct API uses same service | Real-PostgreSQL scope test |
| Certificate issued for ineligible participant | Completed run and confirmed/completed enrollment checked within serialized tenant transaction | Real-PostgreSQL issuance test |
| Public verification leaks private records | Random 192-bit code, trusted tenant host, tenant-local throttling, minimal response, revoked/invalid indistinguishable | Real-PostgreSQL verification/revocation test |
| Private PDF or template crosses tenant | Tenant-derived object keys, tenant-scoped metadata lookups, authenticated download | Real-PostgreSQL storage/tenant test |

## Payment threat update

| Threat | Mitigation | Verification |
|---|---|---|
| Forged or tampered callback | Server-side provider verification, stored amount/currency comparison, tenant and attempt binding, unique invoice | Unit, PostgreSQL, and browser tampering tests |
| Expiration races with late success | Payment/enrollment row locks; expired capacity and coupon remain released; late funds recorded for operator resolution | PostgreSQL race and browser expiration tests |
| Coupon oversubscription or duplicate settlement | Active reservation counts against limit; single transactional redemption; replay idempotency | PostgreSQL concurrency/replay and browser duplicate callback tests |
| Cross-participant financial access | Tenant-scoped owner query and private invoice PDF authorization | PostgreSQL and browser access-denial tests |
| Provider outage or secret leakage | Capability-gated bounded reconciliation, retry backoff, encrypted config, redacted audit/log fields | Fake-provider outage test, config and source review |

Production operational controls still require deployment-specific review.

## B1 custom domain threats

- Domain takeover/cross-tenant routing: globally unique canonical hostname, random expiring TXT proof, exact verified mapping and tenant-bound mutation predicates; tested with two real PostgreSQL tenant fixtures.
- Stale proof after rotation/expiry/deletion: compare the original hash and expiry in the transactional verification UPDATE; race cases use injected DNS and never public DNS.
- Cached removed hostname or stale primary on another process: cache-hit control-plane revalidation plus local invalidation after mutations. In-flight requests remain a documented residual risk.
- Orphaned tenant access: serialized verified-primary selection, partial unique database index and explicit switch-before-delete policy.
- Platform hostname collision: reserve configured platform hostname in registration, creation and resolution. No arbitrary forwarded hostname trust is added.

C1.2 initial owner activation threats: stolen/guessed code, cross-tenant replay, repeated platform retrieval, forged contact verification and secret leakage. Controls: random 256-bit code, 24-hour expiry, tenant-bound authenticated encryption, hashed tenant activation proof, atomic one-time claim/consumption, authenticated platform POST + origin checks, trusted tenant hostname + activation throttling, memory-only disclosure, no query-string delivery or secret audit/logging, and password-setup marker scoped to the organization owner without setting contact verification. Loss after one-time retrieval fails closed and needs operator assistance.


C1.3 local media risks: traversal/link substitution is blocked by key validation, directory/link checks and Linux directory descriptors; untrusted principals must not write the private mount. Container recreation preserves the named volume; backups verify its exact identity and fail closed. Disk exhaustion remains an operator risk: host C: thresholds and monitoring are required, with no automatic cleanup. Migration rejects destination conflicts/overwrite races and preserves local files; the final pass requires quiesced writes before an explicit driver switch.

### Development persistence boundary

Stale generated endpoints and implicit backend switches can hide recoverable media. Explicit driver/root generation and metadata/byte reconciliation prevent silent loss. Separate host/Docker development stores and production volume names prevent accidental mixing. Conflicting transfers fail instead of overwriting; missing sources retain metadata. Development secrets/media are excluded from build contexts and logs. Residual risk: switching stores without a verified transfer, untrusted local filesystem principals, concurrent mutations during transfer, and unavailable historical volumes/backups.
