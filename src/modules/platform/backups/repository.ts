import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { DomainError } from "@/shared/errors/domain-error";
import type { ManualBackupInput, BackupState } from "./schema";

type Job = {
  id: string;
  scope: "FULL_PLATFORM" | "TENANT";
  tenant_id: string | null;
  trigger_type: string;
  state: BackupState;
  request_id: string;
  backup_key: string;
  size_bytes: string | null;
  checksum_verified: boolean;
  safe_error_code: string | null;
  safe_error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
const columns =
  "id,scope,tenant_id,trigger_type,state,request_id,backup_key,size_bytes,checksum_verified,safe_error_code,safe_error_message,started_at,completed_at,created_at,updated_at";
export function safeBackupJob(row: Job) {
  return {
    id: row.id,
    scope: row.scope,
    tenantId: row.tenant_id,
    triggerType: row.trigger_type,
    state: row.state,
    requestId: row.request_id,
    backupKey: row.backup_key,
    sizeBytes: row.size_bytes,
    checksumVerified: row.checksum_verified,
    errorCode: row.safe_error_code,
    errorMessage: row.safe_error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export class BackupRepository {
  constructor(private readonly pool: Pool = getControlPool()) {}
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async audit(
    client: PoolClient,
    job: Job,
    action: string,
    actor: string | null = null,
  ) {
    await appendAuditRecord(client, {
      actorType: actor ? "PLATFORM_ADMIN" : "SYSTEM",
      actorId: actor,
      action,
      targetType: "BACKUP_JOB",
      targetId: job.id,
      requestId: job.request_id,
      afterState: {
        jobId: job.id,
        scope: job.scope,
        tenantId: job.tenant_id,
        state: job.state,
      },
    });
  }
  async enqueue(input: ManualBackupInput, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      if (
        input.scope === "TENANT" &&
        !(
          await client.query(
            "SELECT id FROM tenants WHERE id=$1 FOR KEY SHARE",
            [input.tenantId],
          )
        ).rowCount
      )
        throw new DomainError("NOT_FOUND", "Tenant not found.");
      const id = randomUUID();
      const result = await client.query<Job>(
        `INSERT INTO platform_backup_jobs(id,scope,tenant_id,trigger_type,requested_by,request_id,backup_key) VALUES($1,$2,$3,'MANUAL',$4,$5,$6) RETURNING ${columns}`,
        [
          id,
          input.scope,
          input.scope === "TENANT" ? input.tenantId : null,
          actorId,
          requestId,
          `job-${id}`,
        ],
      );
      const job = result.rows[0];
      if (!job) throw new Error("Backup job insert failed.");
      await this.audit(client, job, "backup.manual_requested", actorId);
      return safeBackupJob(job);
    });
  }
  async list(limit: number, offset: number) {
    return (
      await this.pool.query<Job>(
        `SELECT ${columns} FROM platform_backup_jobs ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      )
    ).rows.map(safeBackupJob);
  }
  async detail(id: string) {
    const row = (
      await this.pool.query<Job>(
        `SELECT ${columns} FROM platform_backup_jobs WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Backup job not found.");
    return safeBackupJob(row);
  }
  async claim() {
    return this.transaction(async (client) => {
      const result = await client.query<Job>(
        `UPDATE platform_backup_jobs SET state='RUNNING',started_at=now(),updated_at=now() WHERE id=(SELECT id FROM platform_backup_jobs WHERE state='QUEUED' AND trigger_type='MANUAL' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ${columns}`,
      );
      const job = result.rows[0];
      if (!job) return null;
      await this.audit(client, job, "backup.started");
      return safeBackupJob(job);
    });
  }
  async transition(
    id: string,
    to: "VERIFYING" | "SUCCEEDED" | "FAILED",
    completion?: { backupKey: string; sizeBytes: string },
  ) {
    if (
      !["VERIFYING", "SUCCEEDED", "FAILED"].includes(to) ||
      (to !== "SUCCEEDED" && completion)
    )
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Backup transition rejected.",
      );
    if (
      to === "SUCCEEDED" &&
      (!completion ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(completion.backupKey) ||
        !/^\d{1,19}$/.test(completion.sizeBytes))
    )
      throw new DomainError(
        "VALIDATION_FAILED",
        "Invalid backup verification result.",
      );
    return this.transaction(async (client) => {
      const from =
        to === "VERIFYING"
          ? ["RUNNING"]
          : to === "SUCCEEDED"
            ? ["VERIFYING"]
            : ["RUNNING", "VERIFYING"];
      const result = await client.query<Job>(
        `UPDATE platform_backup_jobs SET state=$2::text,updated_at=now(),completed_at=CASE WHEN $2::text IN ('SUCCEEDED','FAILED') THEN now() ELSE completed_at END,checksum_verified=($2::text='SUCCEEDED'),backup_key=COALESCE($4,backup_key),size_bytes=$5,safe_error_code=CASE WHEN $2::text='FAILED' THEN 'BACKUP_FAILED' ELSE NULL END,safe_error_message=CASE WHEN $2::text='FAILED' THEN 'Backup execution or verification failed.' ELSE NULL END WHERE id=$1 AND state=ANY($3::text[]) RETURNING ${columns}`,
        [
          id,
          to,
          from,
          completion?.backupKey ?? null,
          completion?.sizeBytes ?? null,
        ],
      );
      const job = result.rows[0];
      if (!job)
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup transition rejected.",
        );
      if (to !== "VERIFYING")
        await this.audit(
          client,
          job,
          to === "SUCCEEDED" ? "backup.succeeded" : "backup.failed",
        );
      return safeBackupJob(job);
    });
  }
  // Trusted host CLI only: explicit allow-list, parameterized tenant identity; never exposed by HTTP.
  async tenantMetadata(tenantId: string) {
    const row = (
      await this.pool.query<{
        metadata: Record<string, unknown>;
        database_name: string;
      }>(
        `
      SELECT r.database_name, jsonb_build_object(
        'tenant',jsonb_build_object('id',t.id,'slug',t.slug,'legalName',t.legal_name,'displayName',t.display_name,'status',t.status,'locale',t.locale,'timezone',t.timezone),
        'registry',jsonb_build_object('databaseName',r.database_name,'migrationVersion',r.migration_version),
        'plan',jsonb_build_object('code',p.code,'name',p.name),
        'features',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',f.feature_key,'enabled',f.enabled)) FROM tenant_features f WHERE f.tenant_id=t.id),'[]'::jsonb),
        'limits',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',l.limit_key,'value',l.limit_value)) FROM tenant_limits l WHERE l.tenant_id=t.id),'[]'::jsonb),
        'branding',(SELECT jsonb_build_object('brandName',b.brand_name,'logoAssetKey',b.logo_asset_key,'primaryColor',b.primary_color,'accentColor',b.accent_color) FROM tenant_branding b WHERE b.tenant_id=t.id),
        'domains',COALESCE((SELECT jsonb_agg(jsonb_build_object('hostname',d.hostname,'type',d.domain_type,'primary',d.is_primary,'verifiedAt',d.verified_at)) FROM tenant_domains d WHERE d.tenant_id=t.id),'[]'::jsonb)
      ) AS metadata FROM tenants t JOIN tenant_database_registry r ON r.tenant_id=t.id JOIN plans p ON p.id=t.plan_id WHERE t.id=$1`,
        [tenantId],
      )
    ).rows[0];
    if (!row || !/^eventos_t_[0-9a-f]{32}$/.test(row.database_name))
      throw new DomainError(
        "VALIDATION_FAILED",
        "Tenant backup registry unavailable.",
      );
    return row.metadata;
  }
}
