# ADR 0002: Isolate tenant operations in a database per tenant

- **Status:** Accepted
- **Context:** The master specification requires one control plane and one independent PostgreSQL database for every tenant. Tenant IDs as row filters in one shared operational schema are not the target.
- **Decision:** Keep only platform metadata in the control database and create a separate PostgreSQL database per tenant. Use generated internal-ID-based names, reviewed tenant migrations, and deterministic baseline seeds.
- **Consequences:** Provisioning, migrations, backups, and pool capacity need explicit lifecycle controls. Cross-tenant SQL joins are unavailable by default. Database connection/resource limits must be observed and tested.
- **Alternatives rejected:** Shared operational tables with tenant ID rely on every query remembering a filter and conflict with the required architecture.
