# Tenant authorization / RBAC

Tenant identity and permission data live only in the tenant's PostgreSQL database. Platform-administrator accounts and their authorization remain in the control plane and cannot be represented by a tenant role.

## Data model and seed

The normalized model is `tenant_users`, `tenant_roles`, `tenant_permissions`, `tenant_user_roles`, and `tenant_role_permissions`, with composite tenant-scoped keys and foreign keys. Users can hold multiple roles. Effective permissions are the distinct union of assigned roles' grants; permissions are not stored as a user JSON list. The owner role receives explicit rows for every catalog permission; application code does not special-case the role name to allow access.

Each tenant is seeded idempotently with the 40 permission keys below and 11 system roles: Organization Owner, Organization Admin, Course Manager, Instructor, Attendance Officer, Finance, Support, Content Manager, Analyst, Reception, and Participant. System roles are immutable through the role API. The last active Organization Owner cannot be suspended, disabled, or removed from the owner role. Existing Phase 1 role templates remain as migration compatibility data; Phase 2 authorization uses normalized grants.

## Permission catalog

| Module | Permission keys |
|---|---|
| Dashboard | `dashboard.read` |
| Staff | `staff.read`, `staff.create`, `staff.update`, `staff.suspend`, `staff.delete` |
| Roles | `role.read`, `role.create`, `role.update`, `role.delete`, `role.assign`, `role.manage` |
| Participants | `participant.read`, `participant.create`, `participant.update`, `participant.suspend` |
| Instructors | `instructor.read`, `instructor.create`, `instructor.update`, `instructor.suspend` |
| Programs (future) | `program.read`, `program.create`, `program.update`, `program.delete`, `program.publish` |
| Sessions (future) | `session.read`, `session.manage` |
| Enrollment (future) | `enrollment.read`, `enrollment.manage` |
| Attendance (future) | `attendance.read`, `attendance.manage` |
| Finance (future) | `finance.read`, `payment.manage`, `refund.manage` |
| Certificates (future) | `certificate.read`, `certificate.issue` |
| Reports | `report.read` |
| Settings | `settings.read`, `settings.manage` |
| Audit | `audit.read` |

Permissions marked high-risk in the catalog (including role administration, staff disable, finance/payment/refund, settings changes, and audit access) are visually called out in the role editor. A seeded future permission does not mean its business module is implemented.

## Evaluation and enforcement

Central policy helpers implement default deny, permission unions, and permission-grant bounds. Each protected request resolves the trusted host first, loads a session from that tenant's database, checks session tenant binding and current user status, and reads current role grants. Tenant APIs and page loaders authorize on the server; UI visibility is a usability filter only. Inputs use strict Zod schemas and explicit fields. A caller may grant only permissions they themselves hold. Role assignment also checks the caller's authority over requested roles, and database/application rules protect the active owner invariant.

`authorizeResource` accepts an actor, required permission, and resource context. It always rejects an actor/resource tenant mismatch and can require an explicit allowed-actor relationship. Phase 2 does not add program/session/enrollment relationship tables, so product-specific object scopes must be connected when those Phase 3 records exist. A tenant-wide permission must not be treated as sufficient evidence of access to every future record.

Navigation is generated from effective permissions and tenant feature flags. Unauthenticated requests receive an authentication denial; authenticated callers lacking authorization receive a generic `403 FORBIDDEN` response. Platform permissions never contribute to tenant grants, and tenant roles never authorize platform operations.

## Auditing

Tenant audit entries record tenant, actor when authenticated, target, request ID, action, state summary, and timestamp. Sensitive operations include invitations and acceptance/revocation, role create/update/delete and permission changes, user-role assignment changes, user status/profile changes, sign-in, and session revocation. Passwords, hashes, tokens, invitation links, cookies, and connection secrets are excluded. Audit rows are append-only at the database layer.
