# Backup and restore

## Required recovery coverage

- Back up the control plane and each tenant database independently; encrypt backups at rest and in transit.
- Retain object-storage versions and any future tenant file backup under tenant-scoped access controls.
- Restrict restore and backup credentials separately from application runtime credentials.
- Record backup age/completeness and restoration outcomes without logging connection strings or personal data.
- Restore the control plane first, then a selected tenant database into an isolated recovery environment; verify migration compatibility, tenant mapping, branding/configuration, and application health.
- Document per-tenant restore, point-in-time recovery, retention expiry, and secure destruction procedures before production.

## Backup Foundation — Step 1 boundary

The existing Windows/IIS `backup.sh` remains the verified operator-run backup execution primitive; its archive/output semantics are unchanged. The PowerShell wrapper normalizes validated absolute drive paths to forward slashes before WSL conversion for Windows PowerShell 5.1 compatibility.

The control-plane `platform_backup_policies` and `platform_backup_jobs` tables provide policy/job metadata for future work. Policies currently support only FULL_PLATFORM scope, DAILY/WEEKLY scheduling metadata, weekday 0=Sunday through 6=Saturday, and retention counts 1..100. Jobs support full-platform or tenant scope with a safe relative identifier rather than an absolute host path. Only bounded safe error descriptions belong in these records; never credentials, environment data, connection strings or raw stack traces.

Step 1 did not execute backups from these schemas/tables. Step 2 adds the manual workflow below. Backup data is sensitive: restrict destination ACLs, encrypt offline copies and rehearse restoration independently. Archive verification is not a restore rehearsal or a claim of production readiness.

## Manual Backup Center — Step 2

Authenticated platform administrators can POST `/api/platform/backups` with only `{ "scope": "FULL_PLATFORM" }` or `{ "scope": "TENANT", "tenantId": "<uuid>" }`. The same-origin mutation creates a QUEUED MANUAL job and an audit record; HTTP never starts a shell or Docker. GET on that endpoint supports limit (1..100) and offset (0..10000); GET `/api/platform/backups/<jobId>` exposes safe job metadata only. Neither endpoint accepts host paths, database names or shell arguments.

The operator-run Windows PowerShell 5.1 wrapper `deployment/windows-iis/powershell/run-backup-jobs.ps1` takes the existing Distribution/WslReleasePath/WindowsBackupDirectory parameters plus `-Apply`. Without Apply it only validates. With Apply it validates the distribution, exact release files and existing Compose isolation, then delegates to the host-only one-shot runner. One invocation claims zero or one queued manual job using PostgreSQL `FOR UPDATE SKIP LOCKED`. Control commands run inside the explicitly scoped `eventos-production` app context via `scripts/backup-job-control.ts`; the app has no Docker socket or host backup-folder mount.

States progress RUNNING → VERIFYING → SUCCEEDED. RUNNING/VERIFYING may become FAILED with a fixed bounded generic error and no stderr/stack/path in job or audit data. Claim/enqueue/completion/failure audits contain only job/scope/tenant/request identifiers and state. A process killed before recording failure can leave a RUNNING/VERIFYING job for operator investigation; automatic recovery/leases are not implemented. Partial archives remain private for investigation and are never pruned in this step.

Full-platform execution preserves `backup.sh <release> <destination>` and its existing dump/media layout and output, adding `manifest.json` to the checksummed files. Tenant execution uses `backup-tenant.sh` with trusted UUID/job context, resolves the database name using a parameterized registry query, and validates the strict EventOS database-name format. Its unique directory contains tenant.dump, control-metadata.json, media.tar.gz, manifest.json and SHA256SUMS. The metadata allow-list contains tenant identity/status/locale/timezone, registry name/migration version, plan code/name, feature toggles, limits, branding and public domain state. It excludes arbitrary tenant metadata, domain challenge tokens, activation codes, platform identities/audits, auth/provider secrets and credentials.

Local tenant media includes only `tenants/<trusted-tenant-id>/` keys, including certificate files. Existing traversal/link protections apply before tar receives a NUL-delimited file list; empty media produces a valid empty archive. Tenant backup currently fails safely for S3 media: an S3 object export adapter is not implemented, so it cannot claim complete tenant-media coverage. Full-platform S3 behavior remains unchanged and requires separately managed object-storage backups/versioning.

Before SUCCEEDED, the runner rechecks nonempty dumps using pg_restore --list, archive gzip/tar validity, manifest job/scope/tenant identity, metadata identity and SHA256SUMS. Completion records only a relative backup identifier, total bytes, checksum_verified=true and completion time. No host absolute path is returned through HTTP. Keep destination ACLs private; backup dumps necessarily contain sensitive application data even though manifests/control metadata exclude secrets.

Automatic scheduling, Scheduled Tasks, retention deletion/pruning and web restore UI/API remain **unimplemented**. Nothing here deploys, restarts workloads or runs migrations automatically.
