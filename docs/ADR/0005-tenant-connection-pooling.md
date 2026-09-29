# ADR 0005: Bound tenant database pools by tenant identity

- **Status:** Accepted
- **Context:** A new ORM/pool per HTTP request can exhaust PostgreSQL connections, while mutating a shared client URL per request can leak tenant context between concurrent operations.
- **Decision:** Introduce a server-only provider keyed by trusted immutable tenant ID and database registry mapping. It owns a finite LRU pool cache, finite per-pool capacity, idle timeout, acquire timeout, disposal on eviction, and sanitized metrics. Do not use a mutable global current-tenant value.
- **Consequences:** Cache capacity and total connection budget must be configurable and measured. Eviction tests and concurrent Tenant A/B PostgreSQL integration tests are required. The initial numeric limits are development defaults, not production capacity claims.
- **Production requirement:** Reassess limits under representative load and document the selected PostgreSQL/proxy pool strategy before production.
