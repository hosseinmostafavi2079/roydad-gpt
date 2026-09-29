# Backup and restore

## Required recovery coverage

- Back up the control plane and each tenant database independently; encrypt backups at rest and in transit.
- Retain object-storage versions and any future tenant file backup under tenant-scoped access controls.
- Restrict restore and backup credentials separately from application runtime credentials.
- Record backup age/completeness and restoration outcomes without logging connection strings or personal data.
- Restore the control plane first, then a selected tenant database into an isolated recovery environment; verify migration compatibility, tenant mapping, branding/configuration, and application health.
- Document per-tenant restore, point-in-time recovery, retention expiry, and secure destruction procedures before production.

Backup infrastructure is not configured in this initial repository state. Backups are not considered valid until restore tests have been scheduled and passed. Production readiness is therefore out of scope.
