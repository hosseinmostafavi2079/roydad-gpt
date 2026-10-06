# EventOS

EventOS is a Persian-first, RTL platform for managing organizations and their events. This repository is built phase by phase from `EVENTOS_CODEX_MASTER_SPEC.md`. Phase 3 adds tenant-local programs, runs, training sessions, instructor scheduling, venues, rooms, calendar, and a local demo. Enrollment and commerce remain later-phase work.

Tenant sign-in is resolved by hostname and uses the tenant's isolated PostgreSQL database. Tenant accounts can hold multiple normalized roles; role permissions are evaluated server-side with default deny. Platform administrators remain separate from tenant users. Authenticator MFA is optional and disabled by default.

## Requirements

- Node.js 22.12 or later
- pnpm 11.25.0
- Docker Engine / Docker Desktop with Compose

## Local setup

1. Copy `.env.example` to `.env` and replace every `replace-with-*` development placeholder with a unique local value. Never reuse these values in production.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install the pinned dependencies: `pnpm install --frozen-lockfile`.
4. Apply control-plane migrations: `pnpm db:migrate`.
5. Create a local synthetic platform administrator: `pnpm db:seed:dev`.
6. Start the platform UI: `pnpm dev` and visit `http://localhost:3000/sign-in`.
7. In a second terminal, run the provisioning worker: `pnpm worker:provisioning`.

Provisioning creates new tenant databases with the current tenant schema and idempotent role/permission seeds before activation. When upgrading an existing Phase 1 installation, use the reviewed migration procedure in [TENANCY.md](docs/TENANCY.md), including `pnpm db:migrate:tenants`; do not reset existing tenant databases.

Production passwords, database URLs, auth keys, the dedicated `TENANT_BOOTSTRAP_ENCRYPTION_KEY`, SMTP credentials, and other secrets belong in a managed secret store. Production configuration requires the dedicated bootstrap encryption key and TLS SMTP. The local admin bootstrap is rejected in production.

## Quality checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e:install
pnpm test:e2e:run
pnpm audit:deps
```

`pnpm check` combines formatter, lint, and strict type-check. `pnpm test:e2e` builds the standalone production server before running Playwright; CI uses the separate `pnpm test:e2e:run` command after its build step. Integration and E2E tests require a disposable real PostgreSQL instance.

See [testing](docs/TESTING.md), [deployment](docs/DEPLOYMENT.md), [security](docs/SECURITY.md), [tenancy](docs/TENANCY.md), and [RBAC](docs/RBAC.md). `TASKS.md` tracks the Phase 3 gate and records explicitly deferred scope.

## Data boundary

The control plane stores platform metadata. Every tenant receives an independent PostgreSQL database; tenant identity, roles, permissions, auth sessions, profiles, invitations, programs, runs, training sessions, venues, rooms, and tenant audit records remain inside it. Domain resolution and tenant database acquisition are server-only and deny unknown, unverified, suspended, and incomplete tenants. Enrollment, finance, attendance, and certificates are deferred.

## Local Demo Access

For one-time setup on Windows, start Docker Desktop, then run from PowerShell in this repository:

```powershell
pnpm install --frozen-lockfile
pnpm local:setup
```

`local:setup` creates `.env` with random local secrets if missing, starts PostgreSQL, applies existing migrations, creates missing synthetic demo data without resetting existing content, passwords or sessions, builds the production Next.js image, and starts the app and provisioning worker in Docker. It preserves existing databases and credentials. The services use `restart: unless-stopped` and remain available without an open terminal. To rebuild after source edits, run `pnpm local:build` and `pnpm local:up`. Use `pnpm local:logs` to inspect service status and `pnpm local:down` to stop containers without deleting PostgreSQL data.

To start automatically after signing in to Windows, enable **Start Docker Desktop when you sign in** in Docker Desktop, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-local-autostart.ps1
```

The scheduled task waits for Docker Desktop and starts the Compose services. It belongs to the current Windows user, contains no passwords, and can be removed with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-local-autostart.ps1
```

For active coding and hot reload, stop the persistent app and worker with `pnpm local:down`, start PostgreSQL with `docker compose up -d postgres`, then run `pnpm dev` and `pnpm worker:provisioning` in separate terminals. `pnpm dev` is a separate development mode; the persistent Docker service runs the production build with `NODE_ENV=production`.

`demo:setup` provisions and migrates only the local `demo` tenant, seeds synthetic demo content, and prints four local logins. It stores generated passwords in the Git-ignored `.demo-credentials.local` file. Keep that file private. The Platform Admin signs in with email and password directly. Run `pnpm demo:setup` again to repair missing sample data without resetting existing tenant databases. Stop any `pnpm dev` process before using the Docker app; both modes use port 3000 and may answer different `localhost` addresses.

Open `http://localhost:3000/sign-in` for the Platform Super Admin, or `http://demo.localhost:3000/login` for the Organization Owner, Instructor, and Participant. Chrome on Windows resolves `demo.localhost` to the loopback interface. The printed login summary and `.demo-credentials.local` identify each account. The owner can create programs, runs, sessions, venues, and rooms; the instructor can inspect assigned runs, sessions, and calendar entries. The participant has a Phase 2 portal shell.

`PLATFORM_REQUIRE_MFA=false` is the default for local and production use. Set it to `true` explicitly to restore mandatory Platform Admin TOTP enrollment and challenge. Run `pnpm local:setup` and rebuild the app after changing this setting. Configure a real TLS `SMTP_URL` in ignored `.env` and rerun `pnpm local:setup` before issuing new invitations; without SMTP, email-dependent flows are unavailable and demo tenant usernames/passwords remain usable. Demo usernames are stored in the private credential file. Docker never selects the test mail transport.

### Tenant Google sign-in

Tenant login and registration share `/login`; `/register` redirects to its registration mode. Google appears only when the tenant's `google_login` feature is enabled **and** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and an exact matching origin in `GOOGLE_OAUTH_ALLOWED_ORIGINS` are configured. In Platform Admin, enable **ورود با گوگل** for that tenant after configuring the server. The same gate applies to the server OAuth endpoints.

For local Docker use, put real credentials in ignored `.env`, set `GOOGLE_OAUTH_ALLOWED_ORIGINS` to the tenant's exact browser origin (for example `http://demo.localhost:3000` if accepted by your Google OAuth client), and register the exact callback URI `http://demo.localhost:3000/api/tenant-auth/callback/google` in a Google **Web application** OAuth client. Google may reject HTTP origins other than its localhost exception; in that case, use a controlled HTTPS development domain and its exact callback. Run `pnpm local:setup` after editing `.env`; the script copies the Google values into ignored `.env.local-runtime` for the Docker app. Rebuild and restart the app. Without real credentials, the Google option stays unavailable. The signed Google identity mock is isolated to Playwright and must not be configured for normal local use.

To remove only the local demo tenant and its generated credentials, stop `pnpm dev` and run `pnpm demo:reset --confirm-demo`. The reset refuses production, CI, nonlocal database hosts, other tenant slugs, and missing explicit confirmation. Then run `pnpm demo:setup` to recreate it. Production never creates demo users.

## Persistent development media

Normal development explicitly uses `MEDIA_STORAGE_DRIVER=local`. `pnpm local:env` creates `.env` only if missing with random development credentials and generates ignored `.env.local-runtime`. Existing secrets and explicit storage choices are retained. `pnpm dev` runs this environment preparation automatically. Initial hot-reload setup:

```sh
pnpm local:env
docker compose up -d postgres
pnpm db:migrate
pnpm db:migrate:tenants
pnpm demo:setup
pnpm dev
# In a second terminal:
pnpm worker:provisioning
```

Host media is stored at the generated absolute `<workspace>/.local/eventos-media` path (forward slashes are used when serializing Windows paths). It is private application data outside public/build directories, ignored by Git and excluded from Docker builds. Normal setup/build commands never clean it.

Docker development uses the app-only named volume `roydad_eventos-local-media` mounted at `/app/data/media`; it never uses `eventos-production_media`. `pnpm local:setup` starts PostgreSQL, applies existing forward migrations, seeds only missing demo data, builds/starts the local app and copies host media into this volume after a dry-run. Existing destination bytes must match or transfer fails without overwriting. Rebuild/recreate commands preserve the named volume:

```sh
pnpm local:build
pnpm local:up
```

The host directory and Docker volume are distinct development stores. Before switching host-written media to Docker, use `pnpm local:media:sync` (dry-run), then `pnpm local:media:sync --apply`; stop media mutations during the transfer. Source bytes and all database IDs/keys/URLs remain unchanged. Do not assume changing modes automatically mirrors subsequent Docker uploads back to the host directory.

S3Mock is optional: `docker compose --profile s3 up -d storage`. Compatibility tests explicitly select `MEDIA_STORAGE_DRIVER=s3` and provide local S3 configuration. The backend never depends on which containers happen to run. CI explicitly starts storage for S3 compatibility.

For historical S3Mock media, run `pnpm local:media:reconcile`, review the per-tenant dry-run result, then `pnpm local:media:reconcile --apply`. This development-only tool reads the current loopback S3Mock and tenant metadata, validates tenant key namespaces, preserves IDs/keys/MIME/size/URLs, verifies size and SHA-256, and never deletes source objects or rewrites metadata. Missing objects are reported by media ID; conflicts fail safely. Inspect older volumes/backups before treating a missing active-bucket object as permanently lost.

`pnpm test:media:development` tests the real existing demo on port 3001 using installed Chrome (or explicit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). This opt-in scenario uploads disposable fixture covers into an existing sample program, verifies API/database/filesystem behavior and removes its fixture at the end. It is forbidden in CI and against non-demo/non-loopback origins.


### Immutable release preparation (manual, no deployment)

`.github/workflows/release-image.yml` accepts only a full approved `commit_sha` on main with successful exact-commit Quality Gates and CodeQL. It builds and validates linux/amd64 off-server, then publishes only `ghcr.io/hosseinmostafavi2079/eventos:sha-<full-sha>` and uploads `eventos-release.json` with the immutable digest reference. Select main when dispatching. This workflow does not deploy, change IIS/DNS/SSL, or generate production secrets. It has not been triggered during local stabilization. Production env files must be independently generated; never copy the development env or credentials.
