# EventOS pilot deployment (manual Linux VPS)

This guide prepares a single-VPS pilot. It does not deploy from CI. Use a reviewed Git tag and keep a record of the image/tag used for each release. The production stack reuses the existing standalone Next.js image and PostgreSQL roles; Caddy is the only public entry point. PostgreSQL, the app port, and the provisioning worker have no host port mappings. The media bucket is an **external** S3-compatible service. Production payments remain disabled because no real gateway adapter is installed.

## Prerequisites

- A maintained Linux distribution such as Ubuntu 24.04 LTS; Docker Engine and the Docker Compose plugin installed by the operator; Node.js 22 and pnpm 11 for the local preflight/smoke commands on the VPS.
- For a pilot, at least 2 vCPU, 4 GiB RAM and 40 GiB free disk; 4 vCPU/8 GiB is preferable when building images on the VPS. Arrange encrypted off-host backup space separately.
- DNS control for the platform and each pilot tenant name. Point `panel.example.com` and `academy.example.com` A/AAAA records to the VPS. Open inbound TCP 80/443 and outbound HTTPS to the certificate authority, S3 provider and Google if enabled. SMTP TCP 465 must reach the chosen mail server. Do not expose 3000 or 5432.
- A real SMTP account and an external S3-compatible bucket supporting HTTPS and server-side AES256 encryption. The existing media adapter uses path-style bucket URLs. Confirm that your provider accepts those behaviors.

The first pilot lists **exact** tenant hostnames in `PUBLIC_HOSTS`. Caddy obtains individual HTTPS certificates using HTTP/TLS challenges; DNS must already resolve to the VPS. Wildcard certificates require DNS challenge credentials and are not configured here. Add a new tenant hostname to DNS and `PUBLIC_HOSTS`, then validate and reload Caddy before creating that tenant. Custom-domain automation is outside this step. Do not use an insecure TLS bypass.

## Initial deployment

Run these commands on the VPS only after reviewing the tag and editing the environment file. They are instructions for the operator; this repository does not execute them remotely.

```bash
git clone https://github.com/hosseinmostafavi2079/roydad-gpt.git
cd roydad-gpt
git checkout <reviewed-release-tag>
corepack enable
pnpm install --frozen-lockfile
cp .env.production.example .env.production
chmod 600 .env.production
${EDITOR:-vi} .env.production
pnpm deploy:preflight
docker compose --env-file .env.production -f compose.production.yaml build app
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps app node --conditions=react-server --import=tsx scripts/db-migrate.ts
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps app node --conditions=react-server --import=tsx scripts/migrate-tenant-databases.ts
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps app node scripts/deploy-preflight.mjs --runtime-only --check-db
```

Control migrations run first, then tenant migrations, before the app starts. Both migration commands are forward-only and idempotent; they do not reset databases. Stop on any failure, inspect the safe logs and fix the cause before continuing. Take a verified backup before later releases.

Create the first platform administrator only once. The command reads credentials from stdin without passing the password in arguments or printing it. Use a unique password of at least 24 characters. The bootstrap refuses to run if any platform administrator already exists.

```bash
read -r -p 'Initial admin email: ' initial_admin_email
read -rs -p 'Initial admin password: ' initial_admin_password; echo
printf '%s\n%s\n' "$initial_admin_email" "$initial_admin_password" | docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps -T app node --conditions=react-server --import=tsx scripts/bootstrap-production-admin.ts
unset initial_admin_email initial_admin_password
docker compose --env-file .env.production -f compose.production.yaml up -d app worker proxy
docker compose --env-file .env.production -f compose.production.yaml ps
```

Verify `https://panel.example.com/api/health/live` and `/api/health/ready`, the platform sign-in page, the certificate shown by the browser, and HTTP-to-HTTPS redirect. Sign in as the initial admin and create the first tenant using the existing platform wizard, with a hostname already listed in `PUBLIC_HOSTS`. Confirm the provisioning worker completes. Then run `pnpm smoke:production`; it checks platform health, tenant home/login, robots and a referenced Next static asset without writing data. Set `SMOKE_PUBLIC_MEDIA_PATH=/api/media/<published-id>` to check an existing public media item without creating one.

## Environment and security

The checked-in `.env.production.example` contains names and placeholders only. Generate every secret independently, for example `openssl rand -hex 48`, and URL-encode any password characters used inside database or SMTP URLs. Store `.env.production` with mode 600 and never commit it. Preflight rejects the template's documentation domains, sample credentials, repeated-character application secrets, and test providers; it cannot measure true randomness, so generate secrets with a cryptographic source. `BETTER_AUTH_URL` must be the exact HTTPS platform origin; `PLATFORM_BASE_DOMAIN` is the parent domain. `PUBLIC_HOSTS` explicitly lists platform plus pilot tenant hosts, and `PILOT_TENANT_HOST` selects a tenant for smoke checks.

Google login remains disabled unless client ID, secret and exact comma-separated tenant origins are all configured **and** the tenant feature is enabled. Register each provider callback as `https://academy.example.com/api/tenant-auth/callback/google`. Do not list broad wildcards or the platform origin. Production uses `MAIL_TRANSPORT=smtp` with a credentialed `smtps://` URL and a public `SMTP_FROM`; test mail transport is rejected. `MEDIA_S3_ALLOW_HTTP_LOCAL=false` and the S3 endpoint must be HTTPS. No S3Mock, E2E Google mock or TEST payment provider is included in this stack. Keep tenant payment features off until a real provider adapter is introduced.

Caddy passes the original Host and overwrites `X-Real-IP`; by default it ignores incoming client `X-Forwarded-*` values. The app resolves tenants using the validated Host and registered domain. Platform cookies are secure and host-scoped in production; tenant auth derives its trusted origin from that host. Origin checks remain in the application. The proxy limits request bodies to 52 MB, matching the existing 51 MB upload request limit. Health endpoints return only status. Do not add client-provided proxy CIDRs without an explicit trusted proxy design.

## Backups and restore

Run `bash scripts/backup-production.sh /absolute/private/backup/directory` on the VPS after the database is healthy and before every upgrade. It creates a timestamped, non-overwriting directory with a custom-format `pg_dump` for the control database and **every** tenant database currently in the registry. Each dump is checked with `pg_restore --list`; it uses the container's existing PostgreSQL password without echoing it. Copy backups to encrypted off-host storage, retain at least one older generation, and practice restoration on an isolated host. The S3 bucket needs its own versioning/backup policy; PostgreSQL dumps do not contain media binaries.

Manual restore is a separate recovery operation: stop app and worker, preserve the failed state, prepare a new isolated PostgreSQL instance, restore the control dump first with `pg_restore`, then restore **every** tenant dump named by the registry. Verify that each `tenant_database_registry.database_name` exists and its tenant metadata matches the registry tenant ID. Recreate the roles using the reviewed `docker/postgres/init-roles.sql` only on a fresh cluster. Inspect migration histories and app/image compatibility before switching traffic. Start app/worker/proxy, run readiness and `pnpm smoke:production`, and compare a sample of tenants and media references. Never run automatic `prisma migrate reset`, drop databases or force-remove volumes during recovery.

## Upgrades and rollback

Before an upgrade, record the current Git tag and image tag, run a backup, validate the new environment and build the reviewed image. Run control then tenant migrations, and start the new app/worker with Compose. Check `docker compose ... ps`, HTTPS, and `pnpm smoke:production`. If the application image fails, restore the prior image/tag and restart the app/worker. A forward database migration may not be compatible with an older image; do not assume SQL rollback is possible. For incompatible changes, restore the matching control **and all tenant** backups on an isolated cluster, verify relationships, then switch traffic. Avoid `docker compose down -v` and `docker system prune`.
