# ADR 0003: Resolve tenants from verified hostnames

- **Status:** Accepted
- **Context:** Browser-supplied tenant IDs are attacker-controlled, and host-to-tenant metadata can be stale or misconfigured.
- **Decision:** Normalize request hostnames and resolve exact verified custom domains or configured platform subdomains in the control plane. Require ACTIVE status before producing a typed server-side context. Never trust body/query/session tenant selectors.
- **Consequences:** Custom-domain changes require verification and cache invalidation; unknown/unverified hosts fail closed. Tests must prove concurrent tenant contexts do not cross.
- **Alternatives rejected:** Client-selected tenant IDs and unverified `Host` suffix matching do not establish tenant ownership.
