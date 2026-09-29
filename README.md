# EventOS

EventOS is a Persian-first, RTL platform for managing organizations and their events. This repository is built phase by phase from `EVENTOS_CODEX_MASTER_SPEC.md`. The current implementation target is **Phase 2 — Tenant Identity, RBAC & Authorization**. Phase 1 platform foundation and Phase 2 tenant identities, authentication, profiles, invitations, role/permission controls, audit, and authorization foundations are implemented. Phase 3 business workflows have not started.

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

See [testing](docs/TESTING.md), [deployment](docs/DEPLOYMENT.md), [security](docs/SECURITY.md), [tenancy](docs/TENANCY.md), and [RBAC](docs/RBAC.md). `TASKS.md` tracks Phase 2 gates and records explicitly deferred scope.

## Data boundary

The control plane stores platform metadata. Every tenant receives an independent PostgreSQL database; tenant identity, roles, permissions, sessions, profiles, invitations, and tenant audit records remain inside it. Domain resolution and tenant database acquisition are server-only and deny unknown, unverified, suspended, and incomplete tenants. Program, session, enrollment, finance, attendance, certificate, and other Phase 3 workflows are not implemented.
