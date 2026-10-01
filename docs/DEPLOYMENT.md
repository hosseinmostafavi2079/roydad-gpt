# Deployment

## Phase 2 status

Deployment configuration is still under implementation. No production deployment or production-readiness claim is made.

## Required separation and secrets

For tenant Google OAuth in production, provide `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` through the deployment secret store, and list each permitted HTTPS tenant origin exactly in `GOOGLE_OAUTH_ALLOWED_ORIGINS` (comma-separated, no paths or wildcards). Register `<origin>/api/tenant-auth/callback/google` exactly in the Google Web application OAuth client. Enable the tenant's `google_login` feature explicitly; credentials alone do not enable sign-in. Keep the CI-only `EVENTOS_E2E_GOOGLE_MOCK` setting out of production. An unconfigured provider or disabled tenant feature denies the server OAuth endpoint.

- Control-plane database URL: limited to control-plane migrations and application access as configured.
- Provisioning database URL: isolated database-creation/migration identity; unavailable to browser bundles and web request logging.
- Tenant runtime and migration access: least-privilege identities, TLS, connection limits, and explicit network allow-lists.
- Better Auth secret, administrator bootstrap secret, domain verification secret, and tenant owner-bootstrap encryption key: unique external secret-store values in production. `TENANT_BOOTSTRAP_ENCRYPTION_KEY` must be at least 32 characters and must be independent of the auth secret. Placeholders belong only in `.env.example`.
- SMTP recovery and invitation delivery must use TLS. Production configuration requires SMTP and platform MFA; debug mode and local bootstrap credentials are disabled.
- Build a pinned minimal non-root container, provide readiness/liveness checks, and use expand-and-contract migrations for future destructive schema changes.

## Tenant migration rollout

Before deploying Phase 2 to an environment with existing tenants, take and verify backups through the environment's established backup process. Deploy the reviewed application and migration files, then run `pnpm db:migrate:tenants` with the migration credential. Confirm all registered active/suspended tenants report the current version and healthy migration state before serving tenant traffic. The migration command is serialized and repeatable, does not reset tenant databases, and exits unsuccessfully for an unknown baseline/version or verification failure. New tenants are migrated and seeded as part of provisioning. See [TENANCY.md](TENANCY.md) for the bridge details.

## Release gates

Require schema/migration review, formatter/lint/type-check/tests/build, secret and dependency scans, configured CodeQL analysis, review of provisioner privileges, verified backup restoration, platform administrator TOTP enrollment/recovery, key rotation procedures, and monitoring before production use. Phase 2 automated gates do not replace deployment-specific penetration testing or operational review.
