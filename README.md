# EventOS

EventOS is a Persian-first, RTL platform for managing organizations and their events. This repository is built phase by phase from `EVENTOS_CODEX_MASTER_SPEC.md`. Phase 3 adds tenant-local programs, runs, training sessions, instructor scheduling, venues, rooms, calendar, and a local demo. Enrollment and commerce remain later-phase work.

Tenant sign-in is resolved by hostname and uses the tenant's isolated PostgreSQL database. Tenant accounts can hold multiple normalized roles; role permissions are evaluated server-side with default deny. Platform administrators remain separate from tenant users and require production TOTP MFA.

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

`local:setup` creates `.env` with random local secrets if missing, starts PostgreSQL, applies existing migrations, creates or refreshes synthetic demo data, builds the production Next.js image, and starts the app and provisioning worker in Docker. It preserves existing databases and credentials. The services use `restart: unless-stopped` and remain available without an open terminal. To rebuild after source edits, run `pnpm local:build` and `pnpm local:up`. Use `pnpm local:logs` to inspect service status and `pnpm local:down` to stop containers without deleting PostgreSQL data.

To start automatically after signing in to Windows, enable **Start Docker Desktop when you sign in** in Docker Desktop, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-local-autostart.ps1
```

The scheduled task waits for Docker Desktop and starts the Compose services. It belongs to the current Windows user, contains no passwords, and can be removed with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-local-autostart.ps1
```

For active coding and hot reload, stop the persistent app and worker with `pnpm local:down`, start PostgreSQL with `docker compose up -d postgres`, then run `pnpm dev` and `pnpm worker:provisioning` in separate terminals. `pnpm dev` is a separate development mode; the persistent Docker service runs the production build with `NODE_ENV=production`.

`demo:setup` provisions and migrates only the local `demo` tenant, seeds synthetic Phase 3 content, and prints four local logins. It stores generated passwords in the Git-ignored `.demo-credentials.local` file. Keep that file private. Run `pnpm demo:setup` again to repair missing sample data without resetting existing tenant databases.

Open `http://localhost:3000/sign-in` for the Platform Super Admin, or `http://demo.localhost:3000/login` for the Organization Owner, Instructor, and Participant. Chrome on Windows resolves `demo.localhost` to the loopback interface. The printed login summary and `.demo-credentials.local` identify each account. The owner can create programs, runs, sessions, venues, and rooms; the instructor can inspect assigned runs, sessions, and calendar entries. The participant has a Phase 2 portal shell.

The persistent service keeps production platform MFA enforcement. On the first platform admin login, follow the TOTP enrollment screen and save the recovery codes. Configure a real TLS `SMTP_URL` in ignored `.env` and rerun `pnpm local:setup` before issuing new invitations; without SMTP, delivery fails safely. Docker never selects the test mail transport.

To remove only the local demo tenant and its generated credentials, stop `pnpm dev` and run `pnpm demo:reset --confirm-demo`. The reset refuses production, CI, nonlocal database hosts, other tenant slugs, and missing explicit confirmation. Then run `pnpm demo:setup` to recreate it. Production never creates demo users.
