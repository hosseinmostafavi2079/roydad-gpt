# Security

## Controls in the implemented phases

- Treat platform administration, provisioning credentials, tenant databases, identities, sessions, grants, and domain mappings as privileged assets.
- Validate configuration, hosts, request bodies, identifiers, and status transitions at trust boundaries. Tenant mutation inputs use strict schemas and explicit allow-lists.
- Enforce platform and tenant authentication/authorization in server-side operations with separate identity stores and default-deny policies. There is no public platform or tenant sign-up.
- Use Argon2id password hashing and server-managed sessions. Platform administrators require TOTP MFA in production. Tenant sessions are host/tenant-bound, use secure HTTP-only SameSite cookies, rotate through the auth library, and are rechecked against current tenant/user status and grants on protected requests.
- Apply authentication throttling and generic login/invitation errors. The login path only queries the tenant resolved from the trusted host; it never searches other tenants by email.
- Invitations use random 32-byte base64url tokens, store only a SHA-256 token hash, expire after 24 hours, and are consumed transactionally once. The invitation mail interface uses explicit `MAIL_TRANSPORT=smtp|test`, defaulting to SMTP. Production configuration rejects `test` unless the private Playwright preload is active, requires TLS SMTP, and fails safely if delivery is unavailable. The outbox captures messages only in tests without an application read route; its temporary file is mode 0600 and removed by test teardown. Tokens are never logged or returned in production APIs. Owner bootstrap data is encrypted with a dedicated production key.
- Roles and permissions are tenant-local normalized relations. Effective permissions are current role unions. Role APIs limit grants to the actor's authority, system roles are protected, and the last active Organization Owner is preserved.
- Resource authorization checks tenant context and supports explicit relationship constraints. Phase 3 business relationships and their detailed scopes remain unimplemented.
- Separate control-plane, tenant-runtime, and provisioning/migration credentials. Never expose secrets to browser code or logs. Generate database identifiers from immutable internal IDs and parameterize SQL values.
- Resolve tenant context only from normalized trusted host mappings. Require verified custom domains and an active tenant. Bound tenant pools and provisioning work; serialize migrations, invitation races, and protected-owner changes where needed.
- Audit security-sensitive changes transactionally with tenant/actor/target/request IDs. Exclude passwords, hashes, tokens, connection strings, cookies, and personal data from logs/audit details. Tenant audit entries are append-only.
- Keep CSP, HSTS in production, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors` configured and verified against application asset needs.
- Return generic errors with request IDs. Unexpected authentication-handler exceptions are caught at the API boundary and logged only with error class and request ID.

## Security verification

See `docs/TESTING.md` for unit policy tests, real-PostgreSQL migration/authentication/RBAC/isolation/race tests, and Playwright access-boundary tests. CI also runs dependency audit, Gitleaks, and CodeQL. Local dependency audit and targeted Gitleaks results must be checked at each release. Unresolved exploitable high/critical findings block release.

## Known limits and operational requirements

This repository has no production deployment claim. Production still requires managed secret storage, key rotation, backup and restore exercises, infrastructure/network review, monitored rate limits, and a deployment-specific MFA enrollment/recovery runbook. Use a unique production `TENANT_BOOTSTRAP_ENCRYPTION_KEY` of at least 32 characters; production configuration rejects a missing/short key. Do not reuse development placeholders. Instructor/program/session ownership relationships and other Phase 3 object scopes must be implemented before those business resources are exposed.
