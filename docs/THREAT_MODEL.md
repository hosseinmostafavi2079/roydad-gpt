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

Payment callback forgery, QR replay, file uploads, public registration, participant privacy workflows, and business-record authorization across program/session/enrollment relationships belong to later phases. Future features must add resource-specific authorization before exposing those records. Production controls also depend on deployment infrastructure, backup testing, secret management, monitoring, and recovery procedures.
