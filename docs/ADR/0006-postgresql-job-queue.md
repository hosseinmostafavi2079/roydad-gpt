# ADR 0006: Use PostgreSQL-backed durable jobs for tenant provisioning

- **Status:** Accepted
- **Context:** Phase 1 needs auditable asynchronous provisioning with retries and idempotency. The control plane already depends on PostgreSQL; adding Redis would add a second local/production service before a demonstrated need.
- **Decision:** Use pg-boss for durable jobs and backpressure, stored in a dedicated schema in the control-plane database. Enqueue provisioning jobs inside the control-plane transaction so a tenant cannot commit without its durable job. Run workers as a separate process.
- **Consequences:** The queue schema is managed by pg-boss and must be upgraded deliberately with its version. Initial queue/schema/role setup is serialized across web and worker processes with a PostgreSQL advisory lock. Provisioning job state and retry outcomes are visible; queue latency metrics and alerts are not implemented in Phase 1. The queue role has access only to the queue schema; provisioning credentials stay in the worker.
- **References:** [pg-boss repository and transactional queue capabilities](https://github.com/timgit/pg-boss).
