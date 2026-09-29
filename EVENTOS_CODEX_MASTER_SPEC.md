# EventOS — Codex Master Engineering Specification

> **Purpose:** This file is the authoritative engineering brief for building a production-grade, secure, multi-tenant SaaS platform for managing courses, classes, workshops, webinars, conferences, training programs, and other events.
>
> **Audience:** Codex / AI coding agents and senior software engineers.
>
> **Language:** Code, schemas, tests, technical documentation, identifiers, and commit messages should be in English. The product UI must be Persian-first (RTL) with architecture ready for additional languages.
>
> **Priority order:** **Security & tenant isolation → correctness → data integrity → maintainability → testability → performance → UX → development speed.**
>
> Do not sacrifice any higher-priority item for a lower-priority item.

---

## 0. Mandatory Agent Operating Rules

Read this entire file before changing code.

Treat this document as the primary specification. If the repository contains an existing architecture, first inspect it and reconcile differences safely. Do not rewrite working code merely to make it look different.

### Before coding

1. Inspect the repository structure.
2. Inspect `package.json`, lockfiles, environment templates, ORM/schema files, Docker files, CI files, tests, and existing documentation.
3. Run the existing quality checks before making changes when possible:
   - install dependencies using the repository's existing package manager;
   - type-check;
   - lint;
   - unit/integration tests;
   - production build.
4. Create or update:
   - `docs/ARCHITECTURE.md`
   - `docs/SECURITY.md`
   - `docs/THREAT_MODEL.md`
   - `docs/TESTING.md`
   - `docs/ADR/` for important architectural decisions
   - `TASKS.md` with an implementation checklist.
5. Identify assumptions and record them in the appropriate ADR instead of silently inventing behavior.

### While coding

- Work incrementally.
- Keep each module small and cohesive.
- Do not create large god classes/services/components.
- Prefer explicit code over clever abstractions.
- Do not duplicate business rules between API routes and UI.
- Domain/business rules belong in services/use-cases/domain modules.
- UI components must not access databases directly.
- Never trust browser-supplied tenant IDs, user IDs, roles, prices, discount amounts, permission claims, certificate state, or payment state.
- Never implement custom cryptography.
- Never store raw passwords, API secrets, reset tokens, OTP values, session tokens, or tenant database passwords in logs.
- Never disable security checks to make tests pass.
- Never use `any` merely to silence TypeScript errors.
- Never ignore failed promises.
- Never swallow exceptions without structured logging and an intentional recovery policy.
- Never expose raw ORM/database errors to clients.
- Never run destructive migrations automatically in production.
- Do not introduce microservices unless there is a demonstrated need. Start as a modular monolith with clear boundaries.
- Do not add an external service when the same requirement can be met reliably with the current stack.
- Keep dependencies minimal and prefer mature, actively maintained packages.
- Pin dependency versions through the lockfile.
- Do not blindly run dependency upgrades across the project.

### After every meaningful implementation slice

Run, at minimum:

1. formatter/check;
2. lint;
3. TypeScript type-check;
4. relevant unit tests;
5. relevant integration tests;
6. relevant E2E tests if the user-facing flow changed;
7. production build.

If one fails, fix it before continuing unless there is a documented blocker.

### Completion rule

A feature is **not done** merely because its happy path works. It is done only when:

- authorization is enforced server-side;
- tenant isolation is verified;
- validation exists;
- error states are handled;
- audit requirements are implemented;
- automated tests cover important success and failure paths;
- no secrets or sensitive values leak;
- migrations are safe;
- build/type-check/lint/tests pass;
- documentation is updated.

---

# 1. Product Definition

Build a multi-tenant SaaS platform where independent organizations can operate branded systems for:

- courses;
- recurring classes;
- workshops;
- bootcamps;
- seminars;
- webinars;
- conferences;
- exams;
- private classes;
- meetings;
- other configurable events.

The platform has four major experiences:

1. **Platform / Super Admin**
2. **Organization / Staff**
3. **Instructor**
4. **Participant**

Each organization is called a **Tenant**.

The platform must support true tenant separation. The target architecture for this project is:

- one **Control Plane Database** for SaaS/platform metadata;
- one **independent PostgreSQL database per tenant** for organization operational data.

Do not merge tenant operational records into one shared table unless an explicit future ADR changes the tenancy strategy.

---

# 2. Core Product Goals

The system must allow a platform administrator to:

- create a tenant;
- configure tenant identity and branding;
- provision its database;
- assign a plan;
- set limits;
- enable/disable features;
- configure domain/subdomain;
- suspend/reactivate the tenant;
- observe tenant health and usage;
- manage subscription metadata;
- access support diagnostics safely.

The tenant must then be able to:

- manage staff;
- define roles and permissions;
- manage instructors;
- manage participants;
- create reusable programs;
- create scheduled runs of programs;
- manage sessions;
- assign instructors;
- assign venues/rooms or online delivery;
- publish registration pages;
- set capacity and pricing;
- accept registrations;
- process payments through provider abstractions;
- manage attendance;
- provide QR check-in;
- send notifications;
- issue basic certificates;
- view operational reports;
- maintain an audit trail.

Participants must be able to:

- discover available offerings;
- register;
- pay;
- view their enrollment;
- view session calendar;
- see attendance status;
- receive notifications;
- access invoices;
- download/verify certificates where applicable.

Instructors must have a restricted interface containing only the resources they are authorized to use.

---

# 3. MVP Scope

Implement the MVP in controlled phases.

## Phase 1 — Platform Foundation

- Super Admin authentication
- Control Plane Database
- Tenant CRUD
- Tenant provisioning workflow
- Tenant database provisioning
- Tenant status
- Tenant plan
- Tenant limits
- Feature flags
- Branding
- Subdomain/custom-domain metadata
- Audit logging
- health/status visibility

## Phase 2 — Identity and Authorization

- Tenant user authentication
- secure session management
- staff users
- instructors
- participants
- roles
- permissions
- role-permission assignment
- server-side authorization middleware/policies
- per-resource authorization
- login throttling
- secure password flows if passwords are enabled
- MFA-ready architecture
- mandatory stronger authentication for platform administrators

## Phase 3 — Training/Event Core

- Program
- ProgramRun
- Session
- Venue
- Room
- Instructor assignment
- capacity
- registration window
- delivery mode:
  - in-person
  - online
  - hybrid
- publish/draft/private/archive states
- calendar views
- scheduling conflict detection

## Phase 4 — Participant & Enrollment

- Participant profiles
- custom registration forms
- Enrollment
- enrollment states
- capacity enforcement
- waitlist
- participant dashboard
- staff-assisted/manual registration

## Phase 5 — Commerce

- Price definitions
- coupons
- Payment
- Invoice
- refunds model
- payment provider abstraction
- payment webhook handling
- idempotency
- payment reconciliation primitives

## Phase 6 — Operations

- attendance
- QR attendance
- session check-in/check-out
- absence/late/excused states
- notifications
- certificate basics
- operational reports

---

# 4. Explicitly Deferred Features

Design extension points for these features, but do not overbuild them in the first MVP unless requested:

- quizzes;
- exams engine;
- assignments;
- advanced LMS;
- video hosting;
- communities;
- advanced CRM;
- corporate seat purchasing;
- advanced certificate designer;
- marketing automation;
- AI assistant;
- marketplace;
- sponsor/exhibitor modules;
- booth management;
- lead retrieval;
- native mobile apps;
- advanced accounting;
- payroll;
- instructor settlement;
- full analytics warehouse.

Do not implement speculative abstractions for future features unless the current architecture truly requires them.

---

# 5. Recommended Technical Architecture

Use a **modular monolith** first.

Preferred baseline:

- **Frontend / Web:** Next.js with TypeScript
- **UI:** Tailwind CSS + shadcn/ui or equivalent accessible component primitives
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Cache / Distributed Locks / Rate-limit storage:** Redis
- **Queue / Background Jobs:** BullMQ or a similarly mature Redis-backed queue
- **Object Storage:** S3-compatible storage
- **Containerization:** Docker
- **E2E Tests:** Playwright
- **Unit/Integration Tests:** Vitest
- **Schema Validation:** Zod
- **Observability:** OpenTelemetry-compatible instrumentation
- **Logging:** structured JSON logs with correlation/request IDs

Use latest stable, mutually compatible versions **at project initialization time**. Do not blindly choose beta, canary, RC, or experimental packages for core infrastructure.

If the existing repository already uses compatible alternatives, preserve them when reasonable instead of rewriting the stack.

---

# 6. High-Level Repository Structure

Prefer explicit bounded modules.

Example:

```text
src/
  app/
    (public)/
    (auth)/
    platform/
    organization/
    instructor/
    participant/
    api/

  modules/
    auth/
    platform/
    tenants/
    users/
    rbac/
    programs/
    program-runs/
    sessions/
    venues/
    instructors/
    participants/
    enrollments/
    pricing/
    coupons/
    payments/
    invoices/
    attendance/
    certificates/
    notifications/
    files/
    audit/
    reports/

  infrastructure/
    db/
      control/
      tenant/
    cache/
    queue/
    storage/
    email/
    sms/
    observability/
    security/

  shared/
    errors/
    validation/
    pagination/
    dates/
    money/
    i18n/
    authorization/
    logging/
    testing/

prisma/
  control/
  tenant/

tests/
  unit/
  integration/
  e2e/
  security/
```

Adjust to the framework conventions, but keep boundaries clear.

---

# 7. Multi-Tenant Architecture

## 7.1 Control Plane Database

The control database may contain only SaaS/platform-level metadata such as:

- tenants
- tenant_domains
- tenant_branding
- tenant_plans
- tenant_features
- tenant_limits
- tenant_database_registry
- subscriptions
- platform_admins
- provisioning_jobs
- platform_audit_logs
- usage_counters
- support metadata

It must **not** become a silent second copy of participant/course/payment data.

## 7.2 Tenant Databases

Each tenant gets an independent database, e.g.:

```text
eventos_tenant_000001
eventos_tenant_000002
eventos_tenant_000003
```

Operational data lives only in the tenant database.

Examples:

- users
- roles
- permissions
- participants
- instructors
- programs
- program_runs
- sessions
- enrollments
- attendance
- prices
- coupons
- payments
- invoices
- certificates
- notifications
- files
- audit_logs

## 7.3 Tenant Resolution

Never accept a tenant identifier from a normal client request as trusted truth.

Resolve tenant primarily from the verified hostname/domain mapping:

```text
Request Host
  -> normalize host
  -> resolve tenant in control DB/cache
  -> verify tenant active
  -> attach trusted tenant context
  -> acquire tenant DB handle
  -> execute authorized request
```

If a route uses a tenant slug, validate that it matches the trusted domain/session context.

## 7.4 Tenant Context

Create one strongly typed server-side tenant context carrying at least:

```ts
type TenantContext = {
  tenantId: string
  status: 'ACTIVE' | 'SUSPENDED' | 'PROVISIONING'
  databaseKey: string
  features: ReadonlySet<string>
  limits: TenantLimits
  locale: string
  timezone: string
}
```

Do not store raw database passwords in this object.

## 7.5 Database Credentials

- Tenant DB credentials must never reach the browser.
- Store credentials only in a secure secret store or encrypted-at-rest configuration.
- Use envelope encryption / cloud KMS when available.
- Never hardcode credentials in source control.
- Do not log connection strings.
- Rotate credentials using an explicit operational workflow.
- Principle of least privilege:
  - application role;
  - migration/provisioning role;
  - backup role;
  - observability role;
  should be separate when infrastructure permits.

## 7.6 Connection Management

Database-per-tenant can exhaust database connections if implemented carelessly.

Requirements:

- do not create unlimited Prisma clients;
- use a bounded tenant-client cache;
- implement eviction/lifecycle management;
- use connection pooling appropriate to deployment;
- monitor active connections;
- implement backpressure;
- make tenant DB acquisition observable;
- fail safely when pool limits are reached;
- never open a new connection pool per HTTP request;
- load-test connection behavior before production.

Document the chosen pooling strategy in an ADR.

## 7.7 Tenant Provisioning

Provisioning must be idempotent and auditable.

Suggested state machine:

```text
REQUESTED
  -> DATABASE_CREATING
  -> MIGRATING
  -> SEEDING
  -> VERIFYING
  -> ACTIVE
```

Failure states:

```text
FAILED_DATABASE
FAILED_MIGRATION
FAILED_SEED
FAILED_VERIFICATION
```

Every transition must be recorded.

If provisioning is retried, it must not create duplicate administrators, duplicate roles, or duplicate databases.

## 7.8 Tenant Deletion

Never immediately hard-delete tenant databases from a normal dashboard action.

Use staged deletion:

```text
ACTIVE
-> SUSPENDED
-> PENDING_DELETION
-> BACKUP/EXPORT
-> RETENTION_WINDOW
-> DESTROYED
```

Destructive actions require stronger authorization and re-authentication.

---

# 8. Domain Model

## 8.1 Program

A reusable definition of an offering.

Fields should conceptually support:

- id
- type
- title
- slug
- shortDescription
- description
- category
- level
- objectives
- prerequisites
- intendedAudience
- defaultDuration
- coverAsset
- status
- metadata
- createdBy
- createdAt
- updatedAt

Program should not directly represent one dated occurrence.

## 8.2 ProgramRun

A scheduled execution of a Program.

Supports:

- programId
- title override
- start/end dates
- registration start/end
- delivery mode
- min/max capacity
- waitlist settings
- price configuration
- assigned instructors
- venue/default location
- online provider metadata
- publication state
- certificate rules
- attendance rules

## 8.3 Session

Each run can have multiple sessions.

Session supports:

- date
- start time
- end time
- timezone
- instructor(s)
- delivery mode
- room/location
- online meeting metadata
- capacity override if needed
- attendance configuration
- status
- notes

Use timezone-aware timestamps internally.

## 8.4 Enrollment

Enrollment is separate from Payment.

Recommended states:

```text
PENDING
AWAITING_PAYMENT
CONFIRMED
WAITLISTED
CANCELLED
REFUNDED
COMPLETED
NO_SHOW
```

Transitions must be controlled by application services, not random UI updates.

## 8.5 Payment

Payment is a ledger-like transactional entity, not merely a boolean.

Recommended concepts:

- payment intent
- provider
- provider reference
- amount
- currency
- state
- idempotency key
- request metadata
- verified callback/webhook
- reconciliation status
- failure reason
- createdAt / updatedAt

Do not mark a payment successful using redirect query parameters from the user's browser. Success must be verified server-to-server/provider-side.

## 8.6 Attendance

Recommended states:

```text
PRESENT
ABSENT
LATE
EXCUSED
LEFT_EARLY
```

Keep:

- sessionId
- participantId
- status
- checkInAt
- checkOutAt
- source
- recordedBy
- optional note
- immutable audit details

Add a unique constraint preventing duplicate attendance records for the same participant/session unless business rules explicitly require multiple check-in events in a separate event table.

---

# 9. RBAC and Authorization

Authorization is a first-class security boundary.

## 9.1 Permission Naming

Use explicit permissions such as:

```text
program.read
program.create
program.update
program.delete
program.publish

session.read
session.manage

participant.read
participant.create
participant.update
participant.delete

instructor.read
instructor.manage

enrollment.read
enrollment.manage

attendance.read
attendance.manage

finance.read
payment.manage
refund.manage

certificate.read
certificate.issue

report.read

role.read
role.manage

settings.read
settings.manage
```

## 9.2 Rules

- Never rely on hidden UI buttons for authorization.
- Every sensitive server action must authorize.
- Authorization must happen after authentication and trusted tenant resolution.
- Object-level authorization is required.
- Prevent IDOR/BOLA.
- Users cannot grant permissions they do not have authority to grant.
- Default is deny.
- Platform admin permissions and tenant permissions must be separate domains.
- Support impersonation, if ever added, must be explicit, time-limited, highly audited, and clearly visible in UI.

## 9.3 Default Roles

Seed initial roles such as:

- Organization Owner
- Organization Admin
- Course Manager
- Instructor
- Attendance Officer
- Finance
- Support
- Content Manager
- Analyst
- Reception
- Participant

Roles are templates; permissions remain data-driven.

---

# 10. Authentication & Session Security

Prefer mature security libraries and framework primitives. Do not implement cryptographic protocols manually.

Requirements:

- secure password hashing using Argon2id where password auth exists;
- minimum password quality policy;
- optional passwordless/OTP provider abstraction;
- MFA-ready architecture;
- require MFA or equivalent strong authentication for Platform Admin in production;
- server-managed sessions;
- session identifiers must be unguessable;
- store only hashes of sensitive bearer/session tokens when feasible;
- short-lived high-risk action tokens;
- session rotation after login and privilege changes;
- logout revokes server session;
- account lock/throttling after repeated failures;
- rate limiting;
- re-authentication for high-impact actions;
- secure password reset;
- one-time reset tokens;
- reset tokens expire;
- invalidate appropriate sessions after password reset;
- detect/reset replay attempts.

Cookie requirements when cookies are used:

- `HttpOnly`
- `Secure` in production
- appropriate `SameSite`
- narrow `Path`
- avoid overly broad domain cookies
- CSRF protection for cookie-authenticated state-changing actions.

Do not put authorization claims in long-lived client-controlled storage and trust them without server verification.

---

# 11. Input Validation & Output Safety

Every trust boundary must validate data.

Use Zod or equivalent at:

- route/API boundaries;
- server actions;
- webhook payload parsing;
- environment variable loading;
- external provider responses where practical.

Requirements:

- reject unknown/invalid enum states;
- normalize phone/email intentionally;
- enforce max lengths;
- constrain numeric ranges;
- validate dates and time ranges;
- reject impossible start/end combinations;
- validate pagination;
- validate sort fields against an allow-list;
- do not pass arbitrary client sort/filter fields directly to ORM;
- sanitize filenames;
- prevent path traversal;
- never render untrusted HTML unless sanitized using a mature sanitizer;
- treat rich-text content as hostile input.

Parameterize database operations through ORM/query parameterization.

---

# 12. Web Security Baseline

Use OWASP ASVS as the security verification baseline.

At minimum address:

- broken access control;
- authentication weaknesses;
- session weaknesses;
- injection;
- XSS;
- CSRF;
- SSRF;
- insecure file upload;
- insecure deserialization;
- security misconfiguration;
- sensitive-data exposure;
- vulnerable dependencies;
- logging/monitoring gaps;
- business logic abuse;
- mass assignment;
- race conditions;
- request smuggling considerations at proxy level;
- webhook forgery;
- replay attacks.

## Mandatory headers

Configure an appropriate production security header policy, including:

- Content-Security-Policy
- Strict-Transport-Security
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- frame protection using CSP `frame-ancestors`

Do not copy an unsafe generic CSP. Design it to match actual application needs and remove `unsafe-inline` / `unsafe-eval` where feasible.

---

# 13. CSRF

If authentication uses cookies, all state-changing endpoints/actions must be protected from CSRF.

Use framework/library-supported mechanisms.

Do not assume `SameSite` alone solves all CSRF cases.

Payment webhooks and third-party callbacks use independent signature verification and must not share browser CSRF logic.

---

# 14. Rate Limiting and Abuse Prevention

Rate-limit at least:

- login;
- OTP send;
- OTP verify;
- password reset;
- public registration;
- coupon checking;
- QR check-in;
- payment intent creation;
- webhooks where appropriate;
- expensive searches/reports;
- file uploads;
- public certificate lookup.

Rate limits must be scoped appropriately by combinations such as:

- IP;
- tenant;
- user;
- account identifier;
- endpoint.

Do not allow one tenant to consume all global resources.

---

# 15. QR Attendance Security

QR attendance must not be a static permanent token.

Use a short-lived signed challenge.

Example design:

```text
Session opens check-in window
-> server creates rotating challenge
-> QR contains opaque/signed short-lived value
-> participant submits token while authenticated
-> server verifies:
   - signature
   - expiration
   - tenant
   - session
   - enrollment eligibility
   - check-in window
   - replay rules
-> attendance recorded transactionally
```

Requirements:

- short expiration;
- replay protection/idempotency;
- server-side verification;
- do not encode secrets;
- do not trust participant IDs embedded in a QR;
- optionally support staff override with explicit audit trail;
- location/device restrictions, if introduced, must be configurable and privacy-aware.

---

# 16. Payment Security

Create a provider interface rather than hardcoding one gateway.

Example:

```ts
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  verifyCallback(input: VerifyCallbackInput): Promise<VerifiedPaymentResult>
  refund?(input: RefundInput): Promise<RefundResult>
}
```

Requirements:

- verify all payment results server-side;
- webhook/provider callback signature verification;
- idempotency;
- transactional update of payment/enrollment state;
- duplicate callback safety;
- amount/currency verified against server-side order data;
- never trust price from client;
- record provider reference;
- store enough normalized metadata for reconciliation without storing prohibited payment data;
- no card data storage;
- no secrets in browser;
- retries must be safe;
- use unique database constraints to support idempotency;
- log state transitions without sensitive values.

---

# 17. File Upload Security

Files are hostile input.

Requirements:

- explicit allowed MIME types;
- explicit allowed extensions;
- maximum file sizes;
- random server-side object names;
- never use user filename as filesystem path;
- verify type based on content where practical;
- store outside application execution path;
- private bucket by default;
- time-limited signed download URLs for private files;
- authorization before signing download;
- malware scanning hook/interface;
- image processing isolated from request path;
- strip unnecessary image metadata when appropriate;
- prevent SVG/script upload unless specifically sanitized and safely served;
- never execute uploaded content.

---

# 18. Feature Flags and Limits

Every tenant can have feature flags such as:

```text
courses
events
attendance
qr_attendance
payments
certificates
quiz
assignments
crm
sms
email
ai
custom_domain
branches
```

Limits may include:

- max staff;
- max participants;
- max active runs;
- max storage;
- monthly SMS;
- monthly email;
- number of branches;
- custom domains.

Feature and limit checks must be enforced **server-side**, not only in UI.

Avoid race conditions around quota usage. Use transactions or atomic counters where required.

---

# 19. Registration Forms

Support tenant-defined registration form fields.

Field types:

- text
- textarea
- number
- phone
- email
- date
- select
- radio
- checkbox
- file

Never dynamically create database columns per custom field.

Use normalized form definitions and answer records, or a carefully validated JSON-based approach. Query/report requirements should influence the final design.

Form schema versions must be retained so old registrations remain interpretable after a form changes.

---

# 20. Scheduling and Conflict Detection

Detect:

- instructor overlap;
- room overlap;
- invalid session time;
- session outside run range when not explicitly allowed;
- capacity conflicts;
- venue availability.

Conflict detection must happen server-side within a safe transaction/locking strategy where concurrent writes could race.

---

# 21. Localization

The UI must be Persian-first.

Requirements:

- RTL layout;
- proper RTL component behavior;
- Persian translations;
- locale-aware numbers;
- Jalali display/input support;
- Gregorian timestamps in database;
- explicit timezone handling;
- default tenant timezone configurable;
- never store formatted Persian dates as the canonical date;
- currency abstraction;
- Toman/Rial presentation must be explicit and unambiguous.

Do not mix UTC, server local time, and tenant local time implicitly.

Store timestamps in UTC and convert at boundaries.

---

# 22. UI/UX Requirements

The application should feel like a professional SaaS product, not a generated admin template.

Requirements:

- accessible semantic UI;
- keyboard navigation;
- visible focus states;
- responsive layout;
- mobile-safe core workflows;
- loading states;
- skeletons where appropriate;
- empty states;
- permission-aware navigation;
- clear destructive-action confirmation;
- consistent filters;
- server-side pagination for large data sets;
- saved query state where useful;
- readable Persian typography;
- no hard-coded widths that break RTL;
- charts only where they improve decisions.

Dashboards should be fast and summarize actionable data rather than showing decorative metrics.

---

# 23. Super Admin Modules

Implement:

## Dashboard

- tenants
- active tenants
- suspended tenants
- provisioning failures
- subscription/plan summary
- active users estimates where available
- platform job health
- tenant DB health signals
- usage/limits alerts

## Organizations

- create
- configure
- suspend
- reactivate
- plan
- limits
- features
- domains
- branding
- provisioning status
- health
- usage
- audit trail

## Plans

Plan definitions should map to feature and limit defaults, while allowing controlled tenant-specific overrides.

## Support

Do not build silent super-admin access into tenant accounts.

Any future support access must:

- require explicit reason;
- have elevated authorization;
- be time-limited;
- show a visible impersonation/support banner;
- be logged;
- support revocation.

---

# 24. Tenant Admin Modules

Navigation baseline:

```text
Dashboard
Programs
Program Runs
Sessions
Calendar

Participants
Instructors
Staff

Enrollments
Attendance

Finance
  Payments
  Invoices
  Refunds

Certificates

Communication
  Notifications
  Email
  SMS

Reports

Locations
  Venues
  Rooms

Files

Settings
  Organization
  Branding
  Roles
  Permissions
  Integrations
  Audit Log
```

Menus must be filtered by features + permissions.

Do not treat hiding the menu as the security check.

---

# 25. Instructor Portal

Instructor can only access authorized runs/sessions.

Baseline:

```text
Dashboard
My Programs
My Sessions
Calendar
Participants
Attendance
Files
Messages
Profile
```

Instructor access to personal participant information should be minimized to what is necessary.

Financial access is denied by default.

---

# 26. Participant Portal

Baseline:

```text
Dashboard
My Enrollments
Calendar
Attendance
Payments
Invoices
Certificates
Notifications
Profile
```

Participant must never be able to access another participant's enrollment by changing IDs in URL/API requests.

Create explicit E2E and integration tests for this.

---

# 27. API Design

Use consistent endpoint/action semantics.

Requirements:

- version public/external APIs when exposed;
- consistent error format;
- correlation/request ID;
- pagination;
- bounded page size;
- deterministic sorting;
- safe filtering allow-lists;
- idempotency keys for sensitive creation flows;
- explicit authorization;
- no raw database exceptions;
- no leaking stack traces in production.

Example error envelope:

```json
{
  "error": {
    "code": "ENROLLMENT_CAPACITY_REACHED",
    "message": "Capacity has been reached.",
    "requestId": "..."
  }
}
```

Human-readable messages can be localized at the presentation layer.

---

# 28. Transactions and Concurrency

Use database transactions for business operations spanning related writes.

Mandatory concurrency-safe cases include:

- last available seat registration;
- waitlist promotion;
- coupon usage limit;
- payment confirmation;
- refund state;
- QR attendance replay;
- certificate number generation;
- tenant limit counters where exactness matters.

Do not implement:

```text
read count
if count < capacity
insert
```

without a concurrency strategy.

Use appropriate unique constraints, locking, atomic operations, or serializable/retry patterns according to the specific flow.

---

# 29. Database Design Rules

- use UUIDs/ULIDs or another non-enumerable identifier strategy for externally exposed resources;
- keep database-generated uniqueness constraints;
- use foreign keys where appropriate;
- use unique indexes for invariants;
- index foreign keys and common filters;
- do not index everything;
- use `createdAt` / `updatedAt`;
- use explicit state enums;
- use decimal/integer minor currency units; never floating point for money;
- model soft deletion only where business requirements justify it;
- do not globally add `deletedAt` to every table without reason;
- use audit logs separately from operational records;
- avoid storing derived values when they can be safely calculated unless needed for history/performance.

All schema changes require migration files and migration tests.

---

# 30. Database Migration Policy

For every migration:

1. review generated SQL;
2. identify locking risk;
3. identify table rewrite risk;
4. identify data backfill requirement;
5. identify rollback/forward recovery path;
6. test on representative data;
7. do not combine large backfills with blocking DDL without a plan.

For destructive schema changes, use expand-and-contract:

```text
add new structure
-> dual read/write if required
-> backfill
-> verify
-> switch
-> remove old structure later
```

Production migration tools must use privileged credentials that are not application runtime credentials.

---

# 31. Audit Logging

Audit security-sensitive and business-critical actions.

Examples:

- login failures where useful;
- role changes;
- permission changes;
- tenant settings;
- feature/limit changes;
- staff creation/deletion;
- attendance overrides;
- payment/refund state changes;
- certificate issue/revoke;
- destructive actions;
- support access;
- domain changes.

Audit record should include:

- timestamp;
- tenant;
- actor type/id;
- action;
- target type/id;
- relevant before/after diff with sensitive fields redacted;
- request/correlation ID;
- source metadata as appropriate.

Audit logs should not be editable by normal tenant users.

Do not store passwords, tokens, OTPs, database URLs, card data, or unnecessary personal data in audit logs.

---

# 32. Logging

Use structured logs.

Required context where available:

```text
requestId
traceId
tenantId
userId
module
operation
duration
result
```

Redact:

- Authorization headers;
- cookies;
- access/refresh/session tokens;
- OTP;
- password;
- reset token;
- DB URL;
- API keys;
- payment secrets;
- private file URLs.

Production logs must not contain full request bodies by default.

---

# 33. Observability

Instrument:

- HTTP latency/error rate;
- database query duration;
- tenant DB acquisition/pool state;
- queue latency/failures;
- payment callback failures;
- notification provider errors;
- provisioning failures;
- storage errors;
- auth failure spikes;
- rate-limit events.

Support distributed trace propagation.

Health endpoints:

- liveness;
- readiness.

Readiness should detect critical unavailable dependencies without exposing secret infrastructure details.

---

# 34. Background Jobs

Use queues for work that should not block requests:

- email;
- SMS;
- certificate generation;
- notification fan-out;
- tenant provisioning;
- large exports;
- cleanup;
- reconciliation;
- image processing.

Every job should support:

- unique/idempotency key where appropriate;
- retry policy;
- exponential backoff;
- maximum attempts;
- dead-letter/failure visibility;
- structured logs;
- tenant context;
- safe retry semantics.

Do not retry permanent validation failures indefinitely.

---

# 35. Notifications

Design channels through provider interfaces.

```ts
interface SmsProvider {
  send(input: SmsMessage): Promise<SendResult>
}

interface EmailProvider {
  send(input: EmailMessage): Promise<SendResult>
}
```

Notification trigger examples:

```text
registration.completed
payment.completed
payment.failed
session.reminder
participant.absent
course.completed
certificate.issued
waitlist.promoted
```

Store delivery state.

Do not let templates inject executable HTML/JS.

---

# 36. Certificate Basics

Certificate issuance must be deterministic and auditable.

Support:

- certificate number;
- participant;
- program/run;
- issue date;
- hours;
- verification token;
- status;
- revocation.

Public certificate verification should expose only intended public information.

Verification tokens should be random and non-sequential.

Do not expose internal participant IDs.

---

# 37. Performance Requirements

Optimize based on measurements, not assumptions.

Baseline practices:

- server-side pagination;
- query projection/select only needed fields;
- avoid N+1 queries;
- batch reads where appropriate;
- cache tenant/domain metadata;
- cache rarely changing feature flags carefully;
- invalidate cache explicitly;
- use Redis for shared caching where necessary;
- no expensive unbounded admin table queries;
- no loading all participants into browser memory;
- protect report endpoints with limits/timeouts;
- queue large exports.

Create realistic load tests for:

- login;
- public course listing;
- course details;
- concurrent registration on near-full capacity;
- QR check-in burst;
- organization dashboard;
- tenant resolution;
- tenant DB connection acquisition.

Performance objectives must be measured and documented after baseline testing instead of inventing unsupported numbers.

---

# 38. Accessibility

Target WCAG 2.2 AA principles where practical.

Test:

- keyboard navigation;
- forms;
- labels;
- validation errors;
- dialogs;
- focus management;
- contrast;
- tables;
- mobile;
- RTL behavior;
- screen-reader semantics for critical flows.

Automate accessibility checks for important pages using Playwright + axe or equivalent.

---

# 39. Testing Strategy

Testing is mandatory.

## 39.1 Unit Tests

Cover:

- domain services;
- validators;
- permission evaluation;
- money/date utilities;
- state transitions;
- feature/limit checks;
- certificate eligibility;
- attendance state logic;
- coupon logic.

## 39.2 Integration Tests

Run against real disposable PostgreSQL/Redis dependencies where practical.

Cover:

- repositories;
- transactions;
- unique constraints;
- migrations;
- authorization at service/API boundary;
- tenant database resolution;
- enrollment concurrency;
- payment idempotency;
- QR replay prevention;
- waitlist promotion;
- audit record creation.

Mock databases are not sufficient for database isolation and migration correctness.

## 39.3 E2E Tests

Use Playwright.

Critical E2E flows:

### Platform

```text
Super Admin logs in
-> creates tenant
-> provisioning completes
-> tenant owner exists
-> branding loads
-> tenant login works
```

### Organization

```text
Admin logs in
-> creates instructor
-> creates Program
-> creates ProgramRun
-> creates sessions
-> sets price/capacity
-> publishes
```

### Participant

```text
Participant opens published run
-> registers
-> payment/test-provider succeeds
-> enrollment becomes confirmed
-> dashboard shows enrollment
```

### Attendance

```text
Authorized participant
-> receives valid QR challenge
-> checks in
-> duplicate/replay is rejected safely
```

### Authorization

```text
Attendance Officer
-> can manage attendance
-> cannot view finance
-> direct API call to finance is 403
```

## 39.4 Tenant Isolation Tests — Mandatory

Create at least Tenant A and Tenant B.

Automated tests must prove:

- A staff cannot read B data;
- A staff cannot update B data;
- A participant cannot fetch B enrollment by ID;
- B domain never receives A branding;
- database connection resolution never reuses the wrong tenant context;
- cache keys are tenant-scoped;
- queue jobs preserve tenant scope;
- file access is tenant-scoped;
- reports cannot cross tenant boundaries;
- audit logs stay in the proper domain;
- support/platform APIs cannot accidentally expose tenant data without explicit privileged paths.

These tests are release blockers.

## 39.5 Security Tests

Automate where reasonable:

- authentication brute-force/rate-limit checks;
- authorization matrix;
- IDOR/BOLA attempts;
- CSRF checks;
- XSS payload handling;
- SQL/injection payload handling;
- file upload abuse;
- path traversal;
- SSRF protections for any URL-fetching feature;
- webhook signature failures;
- replay;
- coupon race;
- enrollment race;
- malicious pagination/filter inputs;
- oversized request handling.

## 39.6 Property/Fuzz Tests

Use property-based/fuzz testing selectively for:

- parser/validator boundaries;
- permission invariants;
- date/time logic;
- discount calculation;
- enrollment capacity invariants;
- QR token validation.

## 39.7 Load Tests

Use k6 or equivalent for important concurrency scenarios.

Do not run destructive heavy load tests against production.

---

# 40. Security Tooling / CI Checks

Where the environment allows, CI should include:

1. format check;
2. lint;
3. TypeScript type-check;
4. unit tests;
5. integration tests;
6. selected E2E smoke tests;
7. production build;
8. dependency vulnerability scanning;
9. secret scanning;
10. static security analysis;
11. container image scanning when containers are built;
12. migration validation;
13. optional DAST against an ephemeral environment.

Possible mature tools include:

- OSV Scanner / equivalent dependency scanner;
- Gitleaks / equivalent secret scanner;
- Semgrep / CodeQL where available;
- Trivy for container/filesystem scanning;
- OWASP ZAP for controlled DAST.

Do not automatically fail production deployment solely on unaudited noisy scanner output. Establish severity policy, triage findings, and document accepted risk.

High/critical exploitable findings should block release unless explicitly reviewed and accepted by an authorized human.

---

# 41. Threat Model

Maintain `docs/THREAT_MODEL.md`.

At minimum model threats for:

## Assets

- tenant databases;
- user credentials;
- personal information;
- payments/invoices;
- attendance history;
- certificates;
- tenant DB credentials;
- API keys;
- storage objects;
- audit logs.

## Trust Boundaries

- browser ↔ application;
- public user ↔ authenticated area;
- platform admin ↔ tenant;
- tenant A ↔ tenant B;
- application ↔ PostgreSQL;
- application ↔ Redis;
- application ↔ object storage;
- application ↔ payment gateway;
- application ↔ SMS/email;
- worker ↔ queue.

## Abuse Cases

- cross-tenant access;
- privilege escalation;
- fake attendance;
- forged payment callback;
- registration overselling;
- coupon reuse race;
- malicious file;
- account takeover;
- reset-token theft;
- QR sharing;
- brute force;
- admin impersonation abuse;
- secret exposure;
- backup exposure;
- destructive tenant deletion.

For each major threat document:

```text
threat
impact
likelihood
mitigation
verification/test
residual risk
```

---

# 42. Privacy & Data Minimization

Collect only data needed by the organization.

Participant fields such as national identifier, medical data, or other sensitive information must not be mandatory platform-wide.

Custom registration fields should allow the tenant to decide what it needs.

Requirements:

- data retention strategy;
- export capability;
- deletion/anonymization capability where legally/operationally applicable;
- access control;
- purpose-limited logs;
- avoid storing sensitive data in analytics events;
- private backups;
- encryption in transit;
- encryption at rest at infrastructure level.

Do not add invasive tracking by default.

---

# 43. Backups and Recovery

Production design must document:

- control DB backup;
- tenant DB backup;
- object storage retention/versioning;
- recovery process;
- backup encryption;
- access control;
- restoration test cadence.

Backups are not trusted until restore has been tested.

Create a documented tenant-level recovery runbook.

---

# 44. Environment Configuration

Validate environment variables at startup.

Classify variables:

- public browser-safe;
- server configuration;
- secret.

Never expose server secrets through `NEXT_PUBLIC_*` or equivalent browser-visible configuration.

Provide:

```text
.env.example
```

with placeholders only.

Do not commit real secrets.

Fail fast on missing critical config.

---

# 45. Docker and Runtime Hardening

Production container expectations:

- multi-stage build;
- minimal runtime image;
- non-root runtime user;
- only required files copied;
- no development tooling in production image where unnecessary;
- health check strategy;
- read-only filesystem where practical;
- temporary writable directories explicit;
- no secrets baked into image layers.

Pin base image by version and maintain it through controlled dependency updates.

---

# 46. Secure Defaults

Default behavior should be restrictive.

Examples:

- new tenant is not public until provisioning completes;
- new feature is off unless plan enables it;
- new role gets no privileged permissions unless assigned;
- uploaded files are private by default;
- public certificate page exposes minimal data;
- participant profiles are not publicly enumerable;
- directory listing disabled;
- debug mode off in production;
- stack traces hidden in production;
- CORS closed by default;
- unsupported HTTP methods rejected;
- custom domain must be verified before activation.

---

# 47. Data Export

CSV/XLSX exports must:

- authorize access;
- apply tenant scope;
- escape spreadsheet formula injection (`=`, `+`, `-`, `@` where needed);
- stream/queue large exports;
- avoid leaking hidden columns;
- audit sensitive exports;
- expire temporary files.

---

# 48. Reporting

MVP reports:

- registrations by period;
- revenue/payment state;
- active runs;
- session attendance rate;
- participant attendance;
- capacity utilization;
- upcoming sessions;
- failed/pending payments.

Reports must be derived from tenant data only.

Do not build an analytics warehouse in MVP.

---

# 49. Search

For MVP, use PostgreSQL-supported search where adequate.

Search must be:

- tenant-scoped;
- permission-scoped;
- paginated;
- bounded;
- resistant to expensive wildcard abuse.

Do not introduce Elasticsearch/OpenSearch without demonstrated need.

---

# 50. Caching

Cache only when behavior is clearly defined.

Good candidates:

- hostname → tenant mapping;
- tenant features;
- tenant limits;
- branding;
- static reference data.

Requirements:

- tenant-aware cache keys;
- TTL;
- explicit invalidation after configuration changes;
- no caching of unauthorized personalized responses across users;
- no shared cache key lacking tenant identifier.

Example:

```text
tenant:{tenantId}:branding:v1
tenant:{tenantId}:features:v1
```

---

# 51. Error Handling

Define domain errors.

Examples:

```text
TENANT_SUSPENDED
FEATURE_DISABLED
LIMIT_REACHED
FORBIDDEN
CAPACITY_REACHED
REGISTRATION_CLOSED
ALREADY_ENROLLED
PAYMENT_VERIFICATION_FAILED
INVALID_QR
QR_EXPIRED
QR_REPLAYED
SESSION_NOT_OPEN
```

Map them consistently to HTTP status codes and localized UI messages.

Unexpected errors get a request ID and safe generic response.

---

# 52. State Machines

Important workflows should use explicit allowed transitions.

Examples:

## Tenant

```text
PROVISIONING -> ACTIVE
PROVISIONING -> FAILED
ACTIVE -> SUSPENDED
SUSPENDED -> ACTIVE
SUSPENDED -> PENDING_DELETION
```

## Enrollment

```text
PENDING -> AWAITING_PAYMENT
PENDING -> CONFIRMED
AWAITING_PAYMENT -> CONFIRMED
AWAITING_PAYMENT -> CANCELLED
WAITLISTED -> CONFIRMED
CONFIRMED -> CANCELLED
CONFIRMED -> COMPLETED
CONFIRMED -> NO_SHOW
```

## Payment

```text
CREATED -> PENDING
PENDING -> SUCCEEDED
PENDING -> FAILED
SUCCEEDED -> REFUND_PENDING
REFUND_PENDING -> REFUNDED
```

Do not allow arbitrary status updates from generic CRUD routes.

---

# 53. Idempotency

Use idempotency for:

- payment creation;
- payment callbacks;
- enrollment submission;
- QR check-in;
- provisioning jobs;
- certificate generation where repeated requests can occur;
- retryable notification jobs.

Idempotency must be backed by persistent state/constraints where correctness depends on it.

---

# 54. Audit vs Event Logs

Do not confuse:

- **Audit Log:** security/business accountability.
- **Domain Event:** internal workflow event.
- **Application Log:** diagnostics.
- **Analytics Event:** product metrics.

Keep their responsibilities separate.

---

# 55. Naming and Code Quality

- TypeScript strict mode.
- Descriptive names.
- No abbreviations unless universally understood.
- No giant files.
- Avoid deeply nested conditionals.
- Prefer early validation/guards.
- Pure functions for calculations.
- Injectable interfaces around external systems.
- No hidden global mutable tenant state.
- No singleton current-tenant variable shared across concurrent requests.
- Avoid circular dependencies.
- Keep DTO/input validation separate from persistence models.
- Do not expose Prisma models directly as public API contracts.

---

# 56. Secure Tenant DB Client Pattern

The implementation must avoid cross-request tenant leakage.

Never do:

```ts
global.currentTenant = tenantId
```

Never mutate one shared ORM client URL per request.

Create a safe tenant DB provider with:

- trusted tenant ID input;
- lookup of encrypted/secure connection material;
- bounded connection/client cache;
- stable mapping;
- lifecycle/eviction;
- connection health handling;
- telemetry;
- tests proving concurrent Tenant A/Tenant B requests cannot cross.

Concurrency tests are mandatory.

---

# 57. Seed Strategy

Provide safe development seeds:

- platform admin development identity;
- Tenant A;
- Tenant B;
- predefined role examples;
- instructors;
- participants;
- sample Programs;
- sessions;
- enrollments;
- attendance.

Seeds must use clearly synthetic data.

Never include real personal information or production secrets.

Provide deterministic seeds for tests.

---

# 58. Local Development

Target one-command local startup where practical.

Example experience:

```bash
docker compose up -d
pnpm install
pnpm db:setup
pnpm dev
```

Use the repository's actual package manager.

Local development should include:

- PostgreSQL;
- Redis;
- S3-compatible local storage if required;
- test payment provider;
- local email catcher if appropriate.

Do not require paid SaaS services to run core development/test flows.

---

# 59. Test Payment Provider

Implement a safe non-production payment provider so E2E tests do not depend on real banking systems.

It should support deterministic scenarios:

- success;
- failure;
- timeout/pending;
- duplicate callback;
- invalid signature;
- refund simulation.

Production payment providers should implement the same interface.

Never make the test provider available in production configuration.

---

# 60. Definition of Done — Feature Checklist

Before declaring any feature complete, verify:

```text
[ ] Requirement implemented
[ ] Server validation implemented
[ ] Authentication checked
[ ] Authorization checked
[ ] Tenant scope checked
[ ] Feature flag checked if relevant
[ ] Limit checked if relevant
[ ] Transaction/concurrency considered
[ ] Audit logging considered
[ ] Error handling added
[ ] Unit tests added
[ ] Integration tests added
[ ] E2E updated if user-facing
[ ] Security cases tested
[ ] RTL/mobile UI checked
[ ] Accessibility checked
[ ] Logs do not expose secrets
[ ] Documentation updated
[ ] Migration reviewed
[ ] Lint passes
[ ] Type-check passes
[ ] Tests pass
[ ] Production build passes
```

---

# 61. Release Quality Gates

A release must not proceed if any of these are true:

- tenant isolation test fails;
- authorization test fails;
- payment verification test fails;
- migration fails;
- critical secrets are detected;
- critical exploitable vulnerability is unresolved;
- type-check fails;
- production build fails;
- required integration tests fail;
- database schema and generated client are inconsistent.

Flaky tests should be fixed, not routinely ignored.

---

# 62. Initial Test Matrix

Codex must create an initial matrix including at least:

| Area | Test |
|---|---|
| Tenant | A cannot read B |
| Tenant | concurrent A/B requests do not leak DB context |
| Auth | unauthenticated protected request denied |
| RBAC | instructor denied finance |
| RBAC | attendance officer can manage attendance only |
| Program | invalid dates rejected |
| Session | instructor conflict detected |
| Session | room conflict detected |
| Enrollment | duplicate enrollment blocked |
| Enrollment | capacity cannot oversell under concurrency |
| Waitlist | full class places user in waitlist |
| Coupon | usage count cannot exceed limit under concurrency |
| Payment | client cannot alter amount |
| Payment | callback verified |
| Payment | duplicate callback idempotent |
| QR | expired token rejected |
| QR | replay rejected |
| QR | non-enrolled participant rejected |
| File | disallowed type rejected |
| File | cross-tenant download denied |
| Admin | destructive operation audited |
| Export | cross-tenant export impossible |
| Cache | keys are tenant-scoped |
| Queue | tenant context retained |
| Domain | unknown/unverified domain rejected |

---

# 63. First Implementation Sequence

Follow this order unless existing repository constraints justify an ADR change.

## Step 1 — Bootstrap and Quality

- establish project;
- strict TypeScript;
- formatter;
- lint;
- test runner;
- Playwright;
- environment validation;
- Docker development;
- CI baseline;
- logging foundation.

## Step 2 — Control Plane

- control DB schema;
- platform admin auth;
- tenants;
- plans;
- features;
- limits;
- branding;
- domains;
- audit.

## Step 3 — Provisioning

- provisioning state machine;
- tenant DB creation adapter;
- tenant migrations;
- seed default roles;
- verification;
- retry/idempotency;
- status UI.

## Step 4 — Tenant Resolver

- domain normalization;
- cache;
- trusted tenant context;
- tenant DB provider;
- isolation/concurrency tests.

## Step 5 — Tenant Identity / RBAC

- users;
- roles;
- permissions;
- session security;
- authorization policies;
- permission tests.

## Step 6 — Program Core

- Program;
- ProgramRun;
- Session;
- venue/room;
- instructor;
- scheduling;
- calendar.

## Step 7 — Participants / Enrollment

- participant;
- registration form;
- enrollment;
- capacity;
- waitlist;
- participant portal.

## Step 8 — Commerce

- pricing;
- coupon;
- test payment provider;
- payment state machine;
- invoice;
- webhook/idempotency.

## Step 9 — Attendance

- attendance records;
- staff attendance UI;
- QR challenge;
- replay protection;
- reports.

## Step 10 — Notifications / Certificates

- notification events;
- queue;
- provider interfaces;
- certificate issue/verify/revoke.

## Step 11 — Hardening

- load testing;
- security scans;
- accessibility;
- CSP;
- rate limiting;
- backup docs;
- operational runbooks;
- performance profiling.

---

# 64. Required Documentation Output

Keep these current:

```text
README.md

docs/
  ARCHITECTURE.md
  SECURITY.md
  THREAT_MODEL.md
  TESTING.md
  DEPLOYMENT.md
  BACKUP_RESTORE.md
  TENANCY.md
  RBAC.md
  PAYMENTS.md
  PROVISIONING.md

  ADR/
    0001-modular-monolith.md
    0002-database-per-tenant.md
    0003-tenant-resolution.md
    0004-authentication.md
    0005-connection-pooling.md
```

Add ADRs only for meaningful decisions.

---

# 65. Final Agent Instructions

When executing this specification:

1. **Do not attempt to build the entire platform in one uncontrolled pass.**
2. Work phase-by-phase.
3. At the start of each phase, inspect the current state.
4. State the exact acceptance criteria in `TASKS.md`.
5. Implement the smallest complete vertical slice.
6. Add tests with the code.
7. Run the test suite.
8. Fix failures.
9. Run build/type-check/lint.
10. Review the diff for:
   - security regression;
   - cross-tenant risks;
   - accidental secret exposure;
   - unnecessary complexity;
   - duplicated logic;
   - unbounded queries;
   - unsafe migrations.
11. Update documentation.
12. Continue only after the phase is stable.

If a requirement conflicts with security, data integrity, or tenant isolation, choose the safer implementation and document the decision.

If an external integration cannot be completed because credentials are unavailable, build a secure provider interface + deterministic local/test adapter, test it fully, and leave clear environment/configuration instructions for the production provider.

Do not fabricate successful tests. Only report a test as passing if it was actually executed successfully.

Do not claim production readiness until:
- all required quality gates pass;
- tenant isolation has automated coverage;
- security checks have been performed;
- backup/restore strategy exists;
- migration process is documented;
- production configuration is separated from development;
- secrets are externally managed.

---

# 66. Security Reference Baseline

The implementation should be checked against current stable official guidance, especially:

- OWASP Application Security Verification Standard (ASVS)
- OWASP Cheat Sheet Series
- framework security documentation
- PostgreSQL security/privilege documentation
- Prisma database connection/pooling guidance
- chosen payment provider security documentation
- chosen cloud/object storage security documentation

Do not treat this file as a substitute for reviewing the current official documentation when configuring security-sensitive infrastructure.

---

# 67. Product Success Scenario

The first major milestone is complete only when this entire flow works with automated tests:

```text
Platform Admin
  -> securely signs in
  -> creates Tenant A
  -> selects plan/features/limits
  -> configures logo/colors/domain
  -> tenant database is provisioned and migrated
  -> Tenant A owner can sign in

Tenant A Admin
  -> creates instructor
  -> creates Program
  -> creates ProgramRun
  -> creates multiple Sessions
  -> sets capacity
  -> sets price
  -> publishes registration

Participant
  -> registers
  -> completes test-provider payment
  -> receives confirmed enrollment
  -> sees course in dashboard

Instructor / Attendance Officer
  -> opens session
  -> participant securely checks in using short-lived QR
  -> attendance is stored
  -> replay attempt fails

Tenant A Admin
  -> views enrollment / attendance / finance reports

Tenant B
  -> exists independently
  -> cannot access, infer, cache, export, or query Tenant A data
```

This end-to-end scenario, especially the final tenant-isolation requirement, is the core acceptance criterion for the MVP.

---

## End of Specification

**Build carefully. Verify continuously. Prefer secure, boring, understandable engineering over clever shortcuts.**
