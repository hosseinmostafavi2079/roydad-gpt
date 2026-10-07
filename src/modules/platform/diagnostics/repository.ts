import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { DomainError } from "@/shared/errors/domain-error";
import { diagnosticCodes } from "./codes";
import {
  type DiagnosticInput,
  eventInputSchema,
  eventListSchema,
  incidentListSchema,
  sanitizeMetadata,
} from "./schema";

const incidentColumns =
  "id,incident_ref,status,severity,component,event_code,tenant_id,summary,probable_cause,first_seen_at,last_seen_at,recovered_at,occurrence_count,latest_request_id";
const eventColumns =
  "id,severity,component,event_code,safe_message,tenant_id,request_id,related_job_id,incident_id,safe_metadata,occurred_at";
type Incident = {
  id: string;
  incident_ref: string;
  status: string;
  severity: string;
  component: string;
  event_code: keyof typeof diagnosticCodes;
  tenant_id: string | null;
  summary: string;
  probable_cause: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  recovered_at: Date | null;
  occurrence_count: string;
  latest_request_id: string | null;
};
type EventRow = {
  id: string;
  severity: string;
  component: string;
  event_code: keyof typeof diagnosticCodes;
  safe_message: string;
  tenant_id: string | null;
  request_id: string | null;
  related_job_id: string | null;
  incident_id: string | null;
  safe_metadata: unknown;
  occurred_at: Date;
};
function safeIncident(row: Incident) {
  const hint = diagnosticCodes[row.event_code];
  // Reconstruct text from reviewed source codes; no arbitrary database text exported.
  return {
    id: row.id,
    incidentRef: row.incident_ref,
    status: row.status,
    severity: row.severity,
    component: row.component,
    eventCode: row.event_code,
    tenantId: row.tenant_id,
    summary: hint?.summary ?? "رخداد عملیاتی ثبت شده است.",
    probableCause: hint?.cause ?? null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    recoveredAt: row.recovered_at,
    occurrenceCount: row.occurrence_count,
    latestRequestId: row.latest_request_id,
    troubleshooting: hint?.checks ?? [],
  };
}
function safeEvent(row: EventRow) {
  let metadata: Record<string, string | number | boolean> = {};
  try {
    metadata = sanitizeMetadata(row.safe_metadata);
  } catch {
    /* Fail closed for historical malformed metadata. */
  }
  return {
    id: row.id,
    severity: row.severity,
    component: row.component,
    eventCode: row.event_code,
    message:
      diagnosticCodes[row.event_code]?.summary ?? "رخداد عملیاتی ثبت شده است.",
    tenantId: row.tenant_id,
    requestId: row.request_id,
    relatedJobId: row.related_job_id,
    incidentId: row.incident_id,
    metadata,
    occurredAt: row.occurred_at,
  };
}
export function heartbeatHealth(
  component: string,
  seen: Date | null,
  status: string,
  now = new Date(),
) {
  if (!seen) return "UNKNOWN";
  const minutes = component === "BACKUP_RUNNER" ? [30, 60] : [2, 5];
  const age = Math.max(0, now.getTime() - seen.getTime());
  if (age > (minutes[1] ?? 5) * 60000) return "UNAVAILABLE";
  if (age > (minutes[0] ?? 2) * 60000) return "DEGRADED";
  return status;
}
export class DiagnosticsRepository {
  constructor(private readonly pool: Pool = getControlPool()) {}
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='1000ms'");
      await client.query("SET LOCAL lock_timeout='500ms'");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  private async event(
    client: PoolClient,
    input: DiagnosticInput,
    incidentId: string | null,
  ) {
    const spec = diagnosticCodes[input.code];
    const metadata = sanitizeMetadata(input.metadata);
    // At most one event per active incident per minute; occurrence count remains exact.
    await client.query(
      `INSERT INTO platform_diagnostic_events(severity,component,event_code,safe_message,tenant_id,request_id,related_job_id,incident_id,safe_metadata)
   SELECT $1::text,$2::text,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::jsonb WHERE NOT EXISTS(SELECT 1 FROM platform_diagnostic_events WHERE component=$2::text AND event_code=$3::text AND tenant_id IS NOT DISTINCT FROM $5::uuid AND incident_id IS NOT DISTINCT FROM $8::uuid AND occurred_at>now()-interval '60 seconds' LIMIT 1)`,
      [
        spec.severity,
        spec.component,
        input.code,
        spec.summary,
        input.tenantId ?? null,
        input.requestId ?? null,
        input.relatedJobId ?? null,
        incidentId,
        JSON.stringify(metadata),
      ],
    );
  }
  async recordDiagnosticEvent(raw: DiagnosticInput) {
    const input = eventInputSchema.parse(raw);
    sanitizeMetadata(input.metadata);
    return this.transaction(async (client) => {
      const spec = diagnosticCodes[input.code];
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${spec.component}:${input.code}:${input.tenantId ?? "platform"}`],
      );
      return this.event(client, input, null);
    });
  }
  async recordOperationalFailure(raw: DiagnosticInput) {
    const input = eventInputSchema.parse(raw);
    sanitizeMetadata(input.metadata);
    const spec = diagnosticCodes[input.code];
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${spec.component}:${input.code}:${input.tenantId ?? "platform"}`],
      );
      const row = (
        await client.query<Incident>(
          `INSERT INTO platform_incidents(incident_ref,severity,component,event_code,tenant_id,summary,probable_cause,latest_request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(component,event_code,(COALESCE(tenant_id::text,'platform'))) WHERE status='OPEN'
    DO UPDATE SET last_seen_at=now(),updated_at=now(),occurrence_count=platform_incidents.occurrence_count+1,latest_request_id=COALESCE(EXCLUDED.latest_request_id,platform_incidents.latest_request_id) RETURNING ${incidentColumns}`,
          [
            `INC-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").toUpperCase()}`,
            spec.severity,
            spec.component,
            input.code,
            input.tenantId ?? null,
            spec.summary,
            spec.cause,
            input.requestId ?? null,
          ],
        )
      ).rows[0];
      if (!row) throw new Error("Incident unavailable");
      await this.event(client, input, row.id);
      return safeIncident(row);
    });
  }
  async recordOperationalRecovery(raw: DiagnosticInput) {
    const input = eventInputSchema.parse(raw);
    sanitizeMetadata(input.metadata);
    const spec = diagnosticCodes[input.code];
    return this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${spec.component}:${input.code}:${input.tenantId ?? "platform"}`],
      );
      return (
        (
          await client.query(
            `UPDATE platform_incidents SET status='RECOVERED',recovered_at=now(),updated_at=now() WHERE component=$1 AND event_code=$2 AND tenant_id IS NOT DISTINCT FROM $3::uuid AND status='OPEN' RETURNING id`,
            [spec.component, input.code, input.tenantId ?? null],
          )
        ).rows[0] ?? null
      );
    });
  }
  async upsertComponentHeartbeat(component: "MAIN_WORKER" | "BACKUP_RUNNER") {
    if (!["MAIN_WORKER", "BACKUP_RUNNER"].includes(component))
      throw new Error("Unknown heartbeat component");
    return this.transaction((client) =>
      client.query(
        `INSERT INTO platform_component_heartbeats(component,status) VALUES($1,'HEALTHY') ON CONFLICT(component) DO UPDATE SET status='HEALTHY',last_seen_at=now(),updated_at=now() WHERE platform_component_heartbeats.last_seen_at<=now()-interval '60 seconds'`,
        [component],
      ),
    );
  }
  async listIncidents(raw: unknown) {
    const filter = incidentListSchema.parse(raw);
    const { where, values } = this.filters(filter, true);
    values.push(filter.limit, filter.offset);
    return (
      await this.pool.query<Incident>(
        `SELECT ${incidentColumns} FROM platform_incidents ${where} ORDER BY last_seen_at DESC,id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      )
    ).rows.map(safeIncident);
  }
  async listDiagnosticEvents(raw: unknown) {
    const filter = eventListSchema.parse(raw);
    const { where, values } = this.filters(filter, false);
    values.push(filter.limit, filter.offset);
    return (
      await this.pool.query<EventRow>(
        `SELECT ${eventColumns} FROM platform_diagnostic_events ${where} ORDER BY occurred_at DESC,id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      )
    ).rows.map(safeEvent);
  }
  private filters(filter: Record<string, unknown>, incidents: boolean) {
    const columns: Record<string, string> = {
      status: "status",
      severity: "severity",
      component: "component",
      tenantId: "tenant_id",
      requestId: incidents ? "latest_request_id" : "request_id",
      incidentRef: "incident_ref",
      incidentId: "incident_id",
    };
    const clauses: string[] = [],
      values: unknown[] = [];
    for (const [key, column] of Object.entries(columns))
      if (filter[key] !== undefined) {
        values.push(filter[key]);
        clauses.push(`${column}=$${values.length}`);
      }
    for (const key of ["from", "to"])
      if (filter[key] !== undefined) {
        values.push(filter[key]);
        clauses.push(
          `${incidents ? "last_seen_at" : "occurred_at"}${key === "from" ? ">=" : "<="}$${values.length}::timestamptz`,
        );
      }
    return {
      where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      values,
    };
  }
  async getIncident(id: string) {
    z.uuid().parse(id);
    const row = (
      await this.pool.query<Incident>(
        `SELECT ${incidentColumns} FROM platform_incidents WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Incident not found.");
    return safeIncident(row);
  }
  async getDiagnosticsSummary(now = new Date()) {
    await this.pool.query("SELECT 1");
    const heartbeats = (
      await this.pool.query<{
        component: string;
        status: string;
        last_seen_at: Date;
      }>(
        "SELECT component,status,last_seen_at FROM platform_component_heartbeats WHERE component IN ('MAIN_WORKER','BACKUP_RUNNER') LIMIT 2",
      )
    ).rows;
    const backup = (
      await this.pool.query<{ state: string }>(
        "SELECT state FROM platform_backup_jobs ORDER BY created_at DESC,id DESC LIMIT 1",
      )
    ).rows[0];
    const failures = (
      await this.pool.query(
        "SELECT 1 FROM provisioning_jobs WHERE state IN ('FAILED_DATABASE','FAILED_MIGRATION','FAILED_SEED','FAILED_VERIFICATION') ORDER BY updated_at DESC LIMIT 1",
      )
    ).rowCount;
    const health = (component: string) => {
      const row = heartbeats.find((value) => value.component === component);
      return heartbeatHealth(
        component,
        row?.last_seen_at ?? null,
        row?.status ?? "UNKNOWN",
        now,
      );
    };
    return {
      components: [
        { component: "APPLICATION", status: "HEALTHY" },
        { component: "CONTROL_DATABASE", status: "HEALTHY" },
        { component: "MAIN_WORKER", status: health("MAIN_WORKER") },
        { component: "BACKUP_RUNNER", status: health("BACKUP_RUNNER") },
        {
          component: "BACKUP_SYSTEM",
          status: !backup
            ? "UNKNOWN"
            : backup.state === "FAILED"
              ? "DEGRADED"
              : ["SUCCEEDED", "PRUNED"].includes(backup.state)
                ? "HEALTHY"
                : "UNKNOWN",
        },
        {
          component: "TENANT_PROVISIONING",
          status: failures ? "DEGRADED" : "HEALTHY",
        },
      ],
    };
  }
  async exportIncident(id: string) {
    const incident = await this.getIncident(id);
    return {
      incident,
      events: await this.listDiagnosticEvents({ incidentId: id, limit: 100 }),
      eventsLimit: 100,
      currentHealth: await this.getDiagnosticsSummary(),
    };
  }
}
