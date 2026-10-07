import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { logger } from "@/infrastructure/logging/logger";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { nextBackupRun } from "./schedule";
import type { BackupState, ManualBackupInput } from "./schema";
import { type BackupPolicy, backupPolicySchema } from "./schema";

type PolicyRow = {
  id: string;
  enabled: boolean;
  scope: "FULL_PLATFORM";
  frequency: "DAILY" | "WEEKLY";
  execution_time: string;
  weekday: number | null;
  timezone: string;
  retention_count: number;
  last_run_at: Date | null;
  next_run_at: Date | null;
};
function safePolicy(row: PolicyRow) {
  return {
    id: row.id,
    enabled: row.enabled,
    scope: row.scope,
    frequency: row.frequency,
    executionTime: row.execution_time.slice(0, 5),
    weekday: row.weekday,
    timezone: row.timezone,
    retentionCount: row.retention_count,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  };
}
function policyInput(row: PolicyRow): BackupPolicy {
  return {
    enabled: row.enabled,
    scope: row.scope,
    frequency: row.frequency,
    executionTime: row.execution_time.slice(0, 5),
    weekday: row.weekday,
    timezone: row.timezone,
    retentionCount: row.retention_count,
  };
}

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
  delete_state?: "QUEUED" | "RUNNING" | "FAILED" | "SUCCEEDED" | null;
  can_delete?: boolean;
  delete_blocked_last?: boolean;
};
type Deletion = {
  id: string;
  backup_job_id: string;
  requested_by: string;
  request_id: string;
  state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
};
const activeDeletion = (alias: string) =>
  `EXISTS(SELECT 1 FROM platform_backup_deletion_requests d WHERE d.backup_job_id=${alias}.id AND d.state IN ('QUEUED','RUNNING'))`;
// Durable deletion reservations are excluded from surviving backups, including
// retention selections whose host-side filesystem operation may be in progress.
const availableGroup = (alias: string) =>
  `SELECT count(*) FROM platform_backup_jobs survivor WHERE survivor.scope=${alias}.scope AND survivor.tenant_id IS NOT DISTINCT FROM ${alias}.tenant_id AND survivor.state='SUCCEEDED' AND survivor.checksum_verified AND survivor.prune_authorized_by IS NULL AND NOT ${activeDeletion("survivor")}`;
const safeKey = (job: Job) => {
  const uuid = "[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}";
  const prefix =
    job.scope === "FULL_PLATFORM" ? "eventos" : `tenant-${job.tenant_id}`;
  return new RegExp(`^${prefix}-[0-9]{8}T[0-9]{6}Z-${uuid}$`).test(
    job.backup_key,
  );
};
const columns =
  "id,scope,tenant_id,trigger_type,state,request_id,backup_key,size_bytes,checksum_verified,safe_error_code,safe_error_message,started_at,completed_at,created_at,updated_at";
const readColumns = `${columns},(SELECT d.state FROM platform_backup_deletion_requests d WHERE d.backup_job_id=j.id ORDER BY d.created_at DESC,d.id DESC LIMIT 1) AS delete_state,(j.state='SUCCEEDED' AND j.checksum_verified AND j.prune_authorized_by IS NULL AND NOT ${activeDeletion("j")} AND (${availableGroup("j")})>1) AS can_delete,(j.state='SUCCEEDED' AND j.checksum_verified AND NOT ${activeDeletion("j")} AND (${availableGroup("j")})<=1) AS delete_blocked_last`;
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
    deleteRequest: {
      state:
        row.delete_state === "SUCCEEDED" ? null : (row.delete_state ?? null),
    },
    canDelete: Boolean(row.can_delete) && safeKey(row),
    deleteProtected: Boolean(row.delete_blocked_last),
  };
}
export class BackupRepository {
  constructor(
    private readonly pool: Pool = getControlPool(),
    private readonly diagnosticWarning: () => void = () =>
      logger.warn(
        { eventCode: "DIAGNOSTICS_WRITE_UNAVAILABLE" },
        "Diagnostic recording unavailable",
      ),
  ) {}
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
        `SELECT ${readColumns} FROM platform_backup_jobs j ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      )
    ).rows.map(safeBackupJob);
  }
  async detail(id: string) {
    const row = (
      await this.pool.query<Job>(
        `SELECT ${readColumns} FROM platform_backup_jobs j WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Backup job not found.");
    return safeBackupJob(row);
  }
  async claim() {
    return this.transaction(async (client) => {
      const result = await client.query<Job>(
        `UPDATE platform_backup_jobs SET state='RUNNING',started_at=now(),updated_at=now() WHERE id=(SELECT id FROM platform_backup_jobs WHERE state='QUEUED' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ${columns}`,
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
    let verificationFailed = false;
    const result = await this.transaction(async (client) => {
      if (to === "FAILED") {
        const previous = (
          await client.query<{ state: string }>(
            "SELECT state FROM platform_backup_jobs WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        verificationFailed = previous?.state === "VERIFYING";
      }
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
    if (to === "FAILED") {
      try {
        await new DiagnosticsRepository(this.pool).recordOperationalFailure({
          code: verificationFailed ? "BACKUP_VERIFY_FAILED" : "BACKUP_FAILED",
          tenantId: result.tenantId,
          requestId: result.requestId,
          relatedJobId: result.id,
          metadata: { scope: result.scope, errorCode: "BACKUP_FAILED" },
        });
      } catch {
        this.diagnosticWarning();
      }
    }
    if (to === "SUCCEEDED") {
      try {
        const diagnostics = new DiagnosticsRepository(this.pool);
        for (const code of ["BACKUP_FAILED", "BACKUP_VERIFY_FAILED"] as const)
          await diagnostics.recordOperationalRecovery({
            code,
            tenantId: result.tenantId,
            requestId: result.requestId,
          });
      } catch {
        this.diagnosticWarning();
      }
    }
    return result;
  }
  private async deletionAudit(
    client: PoolClient,
    job: Job,
    deletion: Deletion,
    action: string,
  ) {
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: deletion.requested_by,
      action,
      targetType: "BACKUP_JOB",
      targetId: job.id,
      requestId: deletion.request_id,
      afterState: {
        jobId: job.id,
        scope: job.scope,
        tenantId: job.tenant_id,
        deletionRequestId: deletion.id,
        state: deletion.state,
      },
    });
  }
  private deletionClaim(job: Job, deletion: Deletion) {
    return {
      id: deletion.id,
      backupJobId: job.id,
      backupKey: job.backup_key,
      scope: job.scope,
      tenantId: job.tenant_id,
    };
  }
  private async assertSurvivor(client: PoolClient, job: Job, required: number) {
    const result = await client.query<{ count: string }>(
      `SELECT (${availableGroup("j")}) AS count FROM platform_backup_jobs j WHERE j.id=$1`,
      [job.id],
    );
    if (Number(result.rows[0]?.count ?? 0) < required)
      throw new DomainError(
        "CONFLICT",
        "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
      );
  }
  async requestDeletion(id: string, actorId: string, requestId: string) {
    return this.transaction(async (client) => {
      // Share retention's policy lock: a queued request reserves its target before
      // any other manual/retention deletion can authorize physical removal.
      await this.lockedPolicy(client);
      const job = (
        await client.query<Job & { prune_authorized_by: string | null }>(
          `SELECT ${columns},prune_authorized_by FROM platform_backup_jobs WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!job) throw new DomainError("NOT_FOUND", "Backup job not found.");
      if (
        job.state !== "SUCCEEDED" ||
        !job.checksum_verified ||
        !safeKey(job) ||
        job.prune_authorized_by
      )
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup deletion unavailable.",
        );
      const existing = (
        await client.query<Deletion>(
          "SELECT * FROM platform_backup_deletion_requests WHERE backup_job_id=$1 AND state IN ('QUEUED','RUNNING') FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (existing) return { id: existing.id, state: existing.state };
      await this.assertSurvivor(client, job, 2);
      const deletion = (
        await client.query<Deletion>(
          "INSERT INTO platform_backup_deletion_requests(backup_job_id,requested_by,request_id) VALUES($1,$2,$3) RETURNING *",
          [id, actorId, requestId],
        )
      ).rows[0];
      if (!deletion) throw new Error("Deletion request unavailable");
      await this.deletionAudit(
        client,
        job,
        deletion,
        "backup.delete_requested",
      );
      return { id: deletion.id, state: deletion.state };
    });
  }
  async claimDeletion() {
    return this.transaction(async (client) => {
      await this.lockedPolicy(client);
      const deletion = (
        await client.query<Deletion>(
          "UPDATE platform_backup_deletion_requests SET state='RUNNING',started_at=now(),updated_at=now() WHERE id=(SELECT id FROM platform_backup_deletion_requests WHERE state='QUEUED' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
        )
      ).rows[0];
      if (!deletion) return null;
      const job = (
        await client.query<Job>(
          `SELECT ${columns} FROM platform_backup_jobs WHERE id=$1 FOR UPDATE`,
          [deletion.backup_job_id],
        )
      ).rows[0];
      if (!job) throw new Error("Deletion target unavailable");
      return this.deletionClaim(job, deletion);
    });
  }
  private async lockedDeletion(client: PoolClient, id: string, key: string) {
    const deletion = (
      await client.query<Deletion>(
        "SELECT * FROM platform_backup_deletion_requests WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!deletion)
      throw new DomainError("NOT_FOUND", "Deletion request not found.");
    const job = (
      await client.query<Job & { prune_authorized_by: string | null }>(
        `SELECT ${columns},prune_authorized_by FROM platform_backup_jobs WHERE id=$1 FOR UPDATE`,
        [deletion.backup_job_id],
      )
    ).rows[0];
    if (
      !job ||
      job.backup_key !== key ||
      !safeKey(job) ||
      job.prune_authorized_by
    )
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Backup deletion authorization unavailable.",
      );
    return { job, deletion };
  }
  async checkDeletion(id: string, key: string) {
    return this.transaction(async (client) => {
      await this.lockedPolicy(client);
      const { job, deletion } = await this.lockedDeletion(client, id, key);
      if (
        deletion.state !== "RUNNING" ||
        job.state !== "SUCCEEDED" ||
        !job.checksum_verified
      )
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup deletion authorization unavailable.",
        );
      await this.assertSurvivor(client, job, 1);
      return this.deletionClaim(job, deletion);
    });
  }
  async completeDeletion(id: string, key: string) {
    return this.transaction(async (client) => {
      await this.lockedPolicy(client);
      const { job, deletion } = await this.lockedDeletion(client, id, key);
      if (deletion.state === "SUCCEEDED" && job.state === "PRUNED")
        return { id, state: deletion.state };
      if (
        deletion.state !== "RUNNING" ||
        job.state !== "SUCCEEDED" ||
        !job.checksum_verified
      )
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup deletion authorization unavailable.",
        );
      await this.assertSurvivor(client, job, 1);
      await client.query(
        "UPDATE platform_backup_jobs SET state='PRUNED',updated_at=now() WHERE id=$1",
        [job.id],
      );
      await client.query(
        "UPDATE platform_backup_deletion_requests SET state='SUCCEEDED',completed_at=now(),updated_at=now() WHERE id=$1",
        [id],
      );
      await this.deletionAudit(
        client,
        { ...job, state: "PRUNED" },
        { ...deletion, state: "SUCCEEDED" },
        "backup.deleted",
      );
      return { id, state: "SUCCEEDED" as const };
    });
  }
  async failDeletion(id: string, key: string) {
    return this.transaction(async (client) => {
      await this.lockedPolicy(client);
      const { job, deletion } = await this.lockedDeletion(client, id, key);
      if (deletion.state === "FAILED") return { id, state: deletion.state };
      if (deletion.state !== "RUNNING" || job.state !== "SUCCEEDED")
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup deletion failure transition unavailable.",
        );
      await client.query(
        "UPDATE platform_backup_deletion_requests SET state='FAILED',safe_error_code='BACKUP_DELETE_FAILED',safe_error_message='Backup deletion failed safely.',completed_at=now(),updated_at=now() WHERE id=$1",
        [id],
      );
      await this.deletionAudit(
        client,
        job,
        { ...deletion, state: "FAILED" },
        "backup.delete_failed",
      );
      return { id, state: "FAILED" as const };
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

  private async lockedPolicy(client: PoolClient) {
    await client.query(
      "INSERT INTO platform_backup_policies(scope,frequency,execution_time,timezone,retention_count,updated_by) VALUES('FULL_PLATFORM','DAILY','02:00','UTC',7,'SYSTEM') ON CONFLICT(scope) DO NOTHING",
    );
    const row = (
      await client.query<PolicyRow>(
        "SELECT * FROM platform_backup_policies WHERE scope='FULL_PLATFORM' FOR UPDATE",
      )
    ).rows[0];
    if (!row) throw new Error("Backup policy unavailable");
    return row;
  }
  async policy() {
    return this.transaction(async (client) =>
      safePolicy(await this.lockedPolicy(client)),
    );
  }
  async updatePolicy(
    input: BackupPolicy,
    actorId: string,
    requestId: string,
    now = new Date(),
  ) {
    const policy = backupPolicySchema.parse(input);
    return this.transaction(async (client) => {
      const before = await this.lockedPolicy(client);
      const next = policy.enabled ? nextBackupRun(policy, now) : null;
      const row = (
        await client.query<PolicyRow>(
          "UPDATE platform_backup_policies SET enabled=$1,frequency=$2,execution_time=$3,weekday=$4,timezone=$5,retention_count=$6,next_run_at=$7,updated_by=$8,updated_at=now() WHERE id=$9 RETURNING *",
          [
            policy.enabled,
            policy.frequency,
            policy.executionTime,
            policy.weekday ?? null,
            policy.timezone,
            policy.retentionCount,
            next,
            actorId,
            before.id,
          ],
        )
      ).rows[0];
      if (!row) throw new Error("Backup policy unavailable");
      const auditValues = (value: ReturnType<typeof safePolicy>) => ({
        enabled: value.enabled,
        frequency: value.frequency,
        executionTime: value.executionTime,
        weekday: value.weekday,
        timezone: value.timezone,
        retentionCount: value.retentionCount,
      });
      await appendAuditRecord(client, {
        actorType: "PLATFORM_ADMIN",
        actorId,
        action: "backup.policy_updated",
        targetType: "BACKUP_POLICY",
        targetId: row.id,
        requestId,
        beforeState: auditValues(safePolicy(before)),
        afterState: auditValues(safePolicy(row)),
      });
      return safePolicy(row);
    });
  }
  async enqueueDueScheduledBackup(now = new Date()) {
    return this.transaction(async (client) => {
      const policy = await this.lockedPolicy(client);
      if (!policy.enabled) return null;
      if (!policy.next_run_at) {
        await client.query(
          "UPDATE platform_backup_policies SET next_run_at=$2 WHERE id=$1",
          [policy.id, nextBackupRun(policyInput(policy), now)],
        );
        return null;
      }
      if (policy.next_run_at > now) return null;
      const id = randomUUID(),
        requestId = randomUUID();
      const job = (
        await client.query<Job>(
          `INSERT INTO platform_backup_jobs(id,scope,trigger_type,request_id,backup_key)VALUES($1,'FULL_PLATFORM','SCHEDULED',$2,$3)RETURNING ${columns}`,
          [id, requestId, `job-${id}`],
        )
      ).rows[0];
      if (!job) throw new Error("Scheduled backup unavailable");
      await client.query(
        "UPDATE platform_backup_policies SET last_run_at=$2,next_run_at=$3,updated_at=now() WHERE id=$1",
        [policy.id, now, nextBackupRun(policyInput(policy), now)],
      );
      await this.audit(client, job, "backup.scheduled_queued");
      return safeBackupJob(job);
    });
  }
  // Authorization is durable: a retry may handle an already removed directory only
  // when the database proves this exact verified backup was selected previously.
  async retentionCandidates(completedJobId: string) {
    return this.transaction(async (client) => {
      const policy = await this.lockedPolicy(client);
      const trigger = (
        await client.query<Job>(
          `SELECT ${columns} FROM platform_backup_jobs WHERE id=$1 AND state='SUCCEEDED' AND checksum_verified AND completed_at IS NOT NULL FOR UPDATE`,
          [completedJobId],
        )
      ).rows[0];
      if (!trigger) return [];
      const ranked = `SELECT id,row_number() OVER(ORDER BY completed_at DESC,created_at DESC,id DESC) AS rank FROM platform_backup_jobs j WHERE scope=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND state='SUCCEEDED' AND checksum_verified AND completed_at IS NOT NULL AND NOT ${activeDeletion("j")}`;
      const result = await client.query<{ id: string; backup_key: string }>(
        `UPDATE platform_backup_jobs j SET prune_authorized_by=$3,prune_authorized_at=now() FROM (SELECT id FROM (${ranked}) ranked WHERE ranked.rank>$4 AND ranked.id<>$3 ORDER BY ranked.rank DESC LIMIT 10) selected WHERE j.id=selected.id RETURNING j.id,j.backup_key`,
        [trigger.scope, trigger.tenant_id, trigger.id, policy.retention_count],
      );
      return result.rows
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 10)
        .map((row) => ({ id: row.id, backupKey: row.backup_key }));
    });
  }
  async retryPruneCandidates() {
    // Only previously selected candidates. Rank is re-evaluated after policy changes.
    const rows = (
      await this.pool.query<{ id: string; backup_key: string }>(
        `SELECT j.id,j.backup_key FROM (SELECT id,backup_key,prune_authorized_by,row_number()OVER(PARTITION BY scope,tenant_id ORDER BY completed_at DESC,created_at DESC,id DESC) AS rank FROM platform_backup_jobs b WHERE state='SUCCEEDED' AND checksum_verified AND completed_at IS NOT NULL AND NOT ${activeDeletion("b")})j JOIN platform_backup_policies p ON p.scope='FULL_PLATFORM' WHERE j.prune_authorized_by IS NOT NULL AND j.rank>p.retention_count ORDER BY j.id LIMIT 10`,
      )
    ).rows;
    return rows.map((row) => ({ id: row.id, backupKey: row.backup_key }));
  }
  async checkPruneCandidate(id: string, key: string) {
    const candidates = await this.retryPruneCandidates();
    if (!candidates.some((row) => row.id === id && row.backupKey === key))
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Backup prune authorization unavailable.",
      );
    return { id, backupKey: key };
  }
  async markPruned(id: string, key: string) {
    return this.transaction(async (client) => {
      const policy = await this.lockedPolicy(client);
      const existing = (
        await client.query<Job & { prune_authorized_by: string | null }>(
          `SELECT ${columns},prune_authorized_by FROM platform_backup_jobs WHERE id=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (
        !existing ||
        existing.backup_key !== key ||
        !existing.prune_authorized_by
      )
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup prune authorization unavailable.",
        );
      if (existing.state === "PRUNED") return safeBackupJob(existing);
      const retained = (
        await client.query(
          `SELECT id FROM platform_backup_jobs j WHERE scope=$1 AND tenant_id IS NOT DISTINCT FROM $2::uuid AND state='SUCCEEDED' AND checksum_verified AND NOT ${activeDeletion("j")} ORDER BY completed_at DESC,created_at DESC,id DESC LIMIT $3`,
          [existing.scope, existing.tenant_id, policy.retention_count],
        )
      ).rows;
      if (
        existing.state !== "SUCCEEDED" ||
        !existing.checksum_verified ||
        (
          await client.query(
            `SELECT 1 FROM platform_backup_deletion_requests WHERE backup_job_id=$1 AND state IN ('QUEUED','RUNNING')`,
            [id],
          )
        ).rowCount ||
        retained.some((row) => row.id === id)
      )
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Backup prune authorization unavailable.",
        );
      const job = (
        await client.query<Job>(
          `UPDATE platform_backup_jobs SET state='PRUNED',updated_at=now() WHERE id=$1 RETURNING ${columns}`,
          [id],
        )
      ).rows[0];
      if (!job) throw new Error("Backup prune unavailable");
      await this.audit(client, job, "backup.pruned");
      return safeBackupJob(job);
    });
  }
}
