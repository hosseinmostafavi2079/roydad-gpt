# Platform diagnostics foundation — Step 5

Diagnostics complements Pino and platform audit. Audit records who changed what; diagnostics records reviewed operational failures. No UI, public monitoring endpoint, Docker log access, Docker socket, host commands or external monitoring service is added.

## Storage and incident correlation

Forward control migration `0015_platform_diagnostics.sql` creates `platform_diagnostic_events`, `platform_incidents` and `platform_component_heartbeats`. Migrations 0013/0014 are unchanged. Diagnostic strings and JSON object size are constrained, tenant/incident references use foreign keys, and counts must be positive.

The server-only repository accepts only source-defined event codes. A PostgreSQL transaction advisory lock plus a partial unique index correlates OPEN incidents by component, event code and tenant (or platform). Identical failures increment the occurrence count and update last seen/request ID. Events are coalesced to at most one per active incident per minute; therefore events are representative samples, not a complete log of every request/job. Recovery closes the matching incident. A subsequent failure creates a new incident with a random `INC-YYYYMMDD-<UUID>` reference. No sequential identifier or process-memory correlation lock is used.

Severity is INFO/WARNING/ERROR/CRITICAL. Control-database unavailability is CRITICAL; provisioning, backup and reconciliation failures are ERROR; the deferred SMS timeout catalogue entry is WARNING. Summary, probable cause and troubleshooting checks come from the local code catalogue. No AI or database-editable HTML is involved.

## Safe data and bounds

Metadata is a flat plain object, with at most eight keys. The only accepted values are reviewed scope/phase/error-code enums, boolean retryability and an integer attempt count 0..1000. Arbitrary strings, nested objects, arrays, Error/Request/Response objects, stack/body fields and sensitive key names are rejected. UUID fields accept only UUIDs. No caller-supplied exception message, SQL, stderr, path, credentials, request body or response body is stored.

DTOs and exports explicitly select safe fields, reconstruct explanatory text from the code catalogue, and revalidate stored metadata (malformed historical metadata becomes an empty object). Pino's existing redaction is unchanged and remains independent of database sanitization. Instrumentation catches its own failures and emits only a fixed safe warning. The backup job-control CLI sends diagnostic warnings to stderr so stdout remains exclusively its existing JSON protocol. Diagnostic transactions use a one-second statement timeout and half-second lock timeout; control-pool acquisition retains its existing five-second connection timeout. It does not retry unavailable writes or create an outage logging loop.

Lists default to 25 rows, maximum 100, offset maximum 10000. Query fields are strict and SQL values parameterized. A supplied from/to range must be ordered and no longer than 31 days; either time bound may be omitted for indexed bounded pagination. Incident export contains at most the newest 100 events, explicitly reports that limit, and includes safe current component health and static troubleshooting checks. There is no diagnostic-record cleanup yet; operator capacity planning and future retention are required.

## Instrumented boundaries

- Readiness: existing SELECT/503/Pino warning is preserved; the warning adds CONTROL_DB_UNAVAILABLE. When that database query fails, **no second database write is attempted**. The outage can therefore exist only in Pino, not incident storage. Successful readiness requests never write diagnostics/heartbeats.
- Provisioning: only a committed failed transition records TENANT_PROVISIONING_FAILED, with tenant/job/request IDs and reviewed phase/error enums. A successful ACTIVE transition recovers that tenant's incident. Existing worker logs/audits/retries are preserved.
- Backup: FAILED after VERIFYING records BACKUP_VERIFY_FAILED; failure after RUNNING records BACKUP_FAILED. Recording occurs after the original transaction commits and uses the same configured pool. Verified SUCCEEDED recovers matching backup incidents. Optional diagnostics failure cannot roll back job state. Existing job error codes, archive checks, queue, retention and host execution are unchanged.
- Payment maintenance: its existing tenant boundary records unexpected operational exceptions; DomainError and Zod validation failures are excluded. A successful reconciliation cycle with zero failures recovers only that tenant's incident. No payment data/provider response is included.

SMS, SMTP and media adapters are intentionally not instrumented here: their errors need reviewed operational classification and trusted tenant context before adding incidents. They retain existing logging/error behavior. Their catalogue entries do not claim active monitoring. Normal invalid passwords, 404s, validation failures and cancellations are not instrumented. There is no global HTTP exception interception and no successful-request diagnostic event.

## Heartbeats and measured health

The provisioning worker records MAIN_WORKER at startup and on a single unref'd 60-second timer, cleared on shutdown. Heartbeat failures cannot crash it. PostgreSQL upsert also suppresses updates within 60 seconds. BACKUP_RUNNER updates when the existing trusted job-control claim executes; no task is installed. There is one row per component, not an append-only heartbeat stream.

Summary returns Application (the request is executing), Control Database (query succeeds), Main Worker, Backup Runner, Backup System and Tenant Provisioning. There is no invented request-time heartbeat. Main Worker is HEALTHY through two minutes, DEGRADED through five, then UNAVAILABLE. Backup Runner uses 30/60 minutes for its expected 15-minute maintenance cadence; never-observed components are UNKNOWN. Long-running backups may make that runner age stale: this is last invocation evidence, not a live process probe. Backup System reflects the latest job: success/pruned is HEALTHY, failed DEGRADED, no history or active job UNKNOWN. Tenant Provisioning is DEGRADED if a failed job exists, otherwise HEALTHY. Historical failed jobs can keep that aggregate degraded; it is not an infrastructure-wide health claim. A summary DB failure uses the existing safe HTTP error response.

## Platform-admin APIs

All routes require the existing Platform Admin guard. Responses are private/no-store. Read access does not create audit spam.

- GET `/api/platform/diagnostics/summary`
- GET `/api/platform/diagnostics/incidents` — status, severity, component, tenantId, incidentRef, latest requestId, from/to, limit/offset
- GET `/api/platform/diagnostics/incidents/<UUID>`
- GET `/api/platform/diagnostics/events` — incidentId, severity, component, tenantId, requestId, from/to, limit/offset
- GET `/api/platform/diagnostics/incidents/<UUID>/export` — JSON attachment named `eventos-incident-INC-....json`

Unknown incident IDs return a safe 404. Export contains no environment, token, auth header, raw stack, Docker inspection/logs, SQL, private media or arbitrary file download.

## Remaining work

No Diagnostics UI/navigation, external monitoring, restore, automatic diagnostic retention, stale-worker recovery or host probing is implemented. The APIs expose measured evidence rather than asserting provider/storage health. Tests use isolated schemas in local PostgreSQL and mocks; no production connection, deployment, push or task installation is performed.
