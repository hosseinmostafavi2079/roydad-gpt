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

Platform-triggered execution, automatic scheduling, retention deletion and tenant-only backup execution are **not implemented** in Step 1. Restore from a web UI does not exist. No backup is executed by these schemas or tables. Backup data is sensitive: restrict destination ACLs, encrypt offline copies and rehearse restoration independently. Archive verification is not a restore rehearsal or a claim of production readiness.
