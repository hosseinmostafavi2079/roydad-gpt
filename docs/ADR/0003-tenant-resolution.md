# ADR 0003: Resolve tenants from verified hostnames

- **Status:** Accepted
- **Context:** Browser-supplied tenant IDs are attacker-controlled, and host-to-tenant metadata can be stale or misconfigured.
- **Decision:** Normalize request hostnames and resolve exact verified custom domains or configured platform subdomains in the control plane. Require ACTIVE status before producing a typed server-side context. Never trust body/query/session tenant selectors.
- **Consequences:** Custom-domain changes require verification and cache invalidation; unknown/unverified hosts fail closed. Tests must prove concurrent tenant contexts do not cross.
- **Alternatives rejected:** Client-selected tenant IDs and unverified `Host` suffix matching do not establish tenant ownership.

## B1 clarification

The platform origin (BETTER_AUTH_URL) is distinct from the generated tenant subdomain namespace (PLATFORM_BASE_DOMAIN). Customer domains need not share that namespace. Reuse the existing tenant_domains schema with no migration. Rotate pending challenges only; verified domains do not lose access through challenge regeneration. Five-second TXT deadlines use an owned cancelable Node resolver (https://nodejs.org/api/dns.html#class-dnspromisesresolver); tests inject DNS. Domain mutations serialize on the tenant row. Deleting the current primary requires switching explicitly first. Cache hits revalidate ownership and primary in PostgreSQL so multi-process domain removal does not depend on a local cache eviction; already-running requests remain outside that guarantee.
