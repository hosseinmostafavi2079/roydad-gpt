# ADR 0001: Start with a modular monolith

- **Status:** Accepted
- **Context:** The repository is empty and the specification prefers a modular monolith. Phase 1 spans authentication, a control plane, provisioning, domains, and tenant DB access, but does not demonstrate independent service scaling needs.
- **Decision:** Keep web routes, domain use cases, platform auth, control-plane repositories, provisioning, and tenant data access as explicit cohesive modules in one TypeScript codebase. Run the web app and bounded provisioning worker as separate processes from that codebase.
- **Consequences:** Clear module boundaries and dependency injection remain important. A shared deployable simplifies local PostgreSQL tests. We can split a module only when operational evidence justifies it.
- **Security:** UI components have no database access; sensitive mutations go through server-side use cases.
