import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { BackupRepository } from "@/modules/platform/backups/repository";

if (existsSync(".env")) process.loadEnvFile(".env");
const schema = `backup_delete_${randomUUID().replaceAll("-", "")}`;
const actor = randomUUID(),
  tenant = randomUUID(),
  otherTenant = randomUUID();
let client: Client, pool: Pool, repo: BackupRepository;
beforeAll(async () => {
  const url = new URL(process.env.CONTROL_MIGRATION_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local test only");
  client = new Client({ connectionString: url.href });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  await applySqlMigrations(
    client,
    path.resolve("src/infrastructure/db/control/migrations"),
    schema,
  );
  await applySqlMigrations(
    client,
    path.resolve("src/infrastructure/db/control/migrations"),
    schema,
  );
  const user = randomUUID(),
    plan = randomUUID();
  await client.query(
    "INSERT INTO platform_auth_users(id,name,email,\"emailVerified\") VALUES($1,'Delete Admin','delete@example.test',true)",
    [user],
  );
  await client.query(
    "INSERT INTO platform_admins(id,auth_user_id,email,display_name) VALUES($1,$2,'delete@example.test','Delete Admin')",
    [actor, user],
  );
  await client.query(
    "INSERT INTO plans(id,code,name) VALUES($1,'delete_test','Test')",
    [plan],
  );
  for (const id of [tenant, otherTenant])
    await client.query(
      "INSERT INTO tenants(id,slug,legal_name,display_name,plan_id,created_by) VALUES($1,$2,'Test','Test',$3,'test')",
      [id, `delete-${id}`, plan],
    );
  pool = new Pool({
    connectionString: url.href,
    options: `-c search_path=${schema},public`,
    max: 5,
  });
  repo = new BackupRepository(pool);
});
beforeEach(async () => {
  await client.query("DELETE FROM platform_backup_deletion_requests");
  await client.query("DELETE FROM platform_backup_jobs");
});
afterAll(async () => {
  if (pool) await pool.end();
  if (client) {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
async function backup(
  tenantId: string | null = null,
  state = "SUCCEEDED",
  time = "2026-01-01T00:00:00Z",
) {
  const id = randomUUID();
  const key = `${tenantId ? `tenant-${tenantId}` : "eventos"}-20260101T000000Z-${randomUUID()}`;
  await client.query(
    "INSERT INTO platform_backup_jobs(id,scope,tenant_id,trigger_type,state,request_id,backup_key,checksum_verified,completed_at,created_at) VALUES($1,$2,$3,'MANUAL',$4,$5,$6,$7,$8,$8)",
    [
      id,
      tenantId ? "TENANT" : "FULL_PLATFORM",
      tenantId,
      state,
      randomUUID(),
      key,
      state === "SUCCEEDED",
      time,
    ],
  );
  return { id, key };
}
const request = (id: string) => repo.requestDeletion(id, actor, randomUUID());
it("applies 0017 once, keeps history and has no path/secret columns", async () => {
  const rows = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='platform_backup_deletion_requests'",
    [schema],
  );
  expect(rows.rows).toHaveLength(11);
  expect(rows.rows.some((row) => /path|secret|key/.test(row.column_name))).toBe(
    false,
  );
  const versions = await client.query(
    `SELECT * FROM "${schema}".eventos_schema_migrations`,
  );
  expect(JSON.stringify(versions.rows)).toContain(
    "0017_backup_manual_deletion",
  );
});
it("enforces active uniqueness, bounded fields and deletion state", async () => {
  const target = await backup();
  await backup();
  await request(target.id);
  await expect(
    client.query(
      "INSERT INTO platform_backup_deletion_requests(backup_job_id,requested_by,request_id) VALUES($1,$2,'duplicate')",
      [target.id, actor],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    client.query(
      "UPDATE platform_backup_deletion_requests SET state='INVALID'",
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    client.query("UPDATE platform_backup_deletion_requests SET request_id=''"),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    client.query(
      "UPDATE platform_backup_deletion_requests SET safe_error_message='secret /host/path'",
    ),
  ).rejects.toMatchObject({ code: "23514" });
});
it.each(["QUEUED", "RUNNING", "VERIFYING", "FAILED", "PRUNED"])(
  "rejects deletion of %s backups",
  async (state) => {
    const target = await backup(null, state);
    await backup();
    await expect(request(target.id)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  },
);
it("rejects missing, unverified and unsafe-key targets", async () => {
  await expect(request(randomUUID())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const target = await backup();
  await backup();
  await client.query(
    "UPDATE platform_backup_jobs SET checksum_verified=false WHERE id=$1",
    [target.id],
  );
  await expect(request(target.id)).rejects.toMatchObject({
    code: "INVALID_STATE_TRANSITION",
  });
  await client.query(
    "UPDATE platform_backup_jobs SET checksum_verified=true,backup_key='job-not-a-verified-archive' WHERE id=$1",
    [target.id],
  );
  await expect(request(target.id)).rejects.toMatchObject({
    code: "INVALID_STATE_TRANSITION",
  });
});
it("protects the last verified full backup", async () => {
  const target = await backup();
  await backup(tenant);
  expect((await repo.detail(target.id)).deleteProtected).toBe(true);
  await expect(request(target.id)).rejects.toMatchObject({
    code: "CONFLICT",
    message: "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
  });
});
it("protects each tenant's final backup independently", async () => {
  const target = await backup(tenant);
  await backup(otherTenant);
  await backup(otherTenant);
  await backup();
  await expect(request(target.id)).rejects.toMatchObject({ code: "CONFLICT" });
  const second = await backup(tenant);
  expect((await request(target.id)).state).toBe("QUEUED");
  await expect(request(second.id)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("serializes concurrent deletion requests so one usable backup survives", async () => {
  const a = await backup(),
    b = await backup();
  const results = await Promise.allSettled([request(a.id), request(b.id)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (await client.query("SELECT * FROM platform_backup_deletion_requests"))
      .rows,
  ).toHaveLength(1);
});
it("handles concurrent duplicates idempotently and audits only once", async () => {
  const target = await backup();
  await backup();
  const results = await Promise.all([request(target.id), request(target.id)]);
  expect(results[0]?.id).toBe(results[1]?.id);
  const audit = (
    await client.query(
      "SELECT * FROM platform_audit_logs WHERE action='backup.delete_requested' AND target_id=$1",
      [target.id],
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0].actor_id).toBe(actor);
  expect(audit[0].target_id).toBe(target.id);
  expect(Object.keys(audit[0].after_state).sort()).toEqual([
    "deletionRequestId",
    "jobId",
    "scope",
    "state",
    "tenantId",
  ]);
  expect(JSON.stringify(audit)).not.toContain(target.key);
  expect((await repo.detail(target.id)).deleteRequest.state).toBe("QUEUED");
});
it("claims atomically, exposes only trusted fields and checks exact key/state", async () => {
  const target = await backup();
  await backup();
  const deletion = await request(target.id);
  await expect(
    repo.checkDeletion(deletion.id, target.key),
  ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  const claims = await Promise.all([
    repo.claimDeletion(),
    repo.claimDeletion(),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(Object.keys(claims.find(Boolean) ?? {}).sort()).toEqual([
    "backupJobId",
    "backupKey",
    "id",
    "scope",
    "tenantId",
  ]);
  expect(claims.find(Boolean)?.id).toBe(deletion.id);
  await expect(
    repo.checkDeletion(deletion.id, "../escape"),
  ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  expect((await repo.checkDeletion(deletion.id, target.key)).backupJobId).toBe(
    target.id,
  );
  expect((await repo.detail(target.id)).deleteRequest.state).toBe("RUNNING");
});
it("completes deletion as PRUNED, preserves history, and repeats completion safely", async () => {
  const target = await backup();
  const survivor = await backup();
  const deletion = await request(target.id);
  await repo.claimDeletion();
  await repo.completeDeletion(deletion.id, target.key);
  await repo.completeDeletion(deletion.id, target.key);
  expect((await repo.detail(target.id)).state).toBe("PRUNED");
  expect((await repo.detail(target.id)).deleteRequest.state).toBeNull();
  expect((await repo.detail(survivor.id)).deleteProtected).toBe(true);
  expect(
    (
      await client.query(
        "SELECT state FROM platform_backup_deletion_requests WHERE id=$1",
        [deletion.id],
      )
    ).rows[0].state,
  ).toBe("SUCCEEDED");
  expect(await repo.list(25, 0)).toHaveLength(2);
  expect(
    (
      await client.query(
        "SELECT * FROM platform_audit_logs WHERE action='backup.deleted' AND target_id=$1",
        [target.id],
      )
    ).rows,
  ).toHaveLength(1);
});
it("fails only the deletion request and keeps a successful backup retriable", async () => {
  const target = await backup();
  await backup();
  const deletion = await request(target.id);
  await repo.claimDeletion();
  await repo.failDeletion(deletion.id, target.key);
  await repo.failDeletion(deletion.id, target.key);
  expect((await repo.detail(target.id)).state).toBe("SUCCEEDED");
  expect((await repo.detail(target.id)).deleteRequest.state).toBe("FAILED");
  expect((await repo.detail(target.id)).canDelete).toBe(true);
  const row = (
    await client.query(
      "SELECT * FROM platform_backup_deletion_requests WHERE id=$1",
      [deletion.id],
    )
  ).rows[0];
  expect(row.safe_error_code).toBe("BACKUP_DELETE_FAILED");
  expect(row.safe_error_message).toBe("Backup deletion failed safely.");
  expect(
    (
      await client.query(
        "SELECT * FROM platform_audit_logs WHERE action='backup.delete_failed' AND target_id=$1",
        [target.id],
      )
    ).rows,
  ).toHaveLength(1);
  expect((await request(target.id)).id).not.toBe(deletion.id);
});
it("coordinates retention and manual reservations without removing the final survivor", async () => {
  const old = await backup(),
    middle = await backup(null, "SUCCEEDED", "2026-02-01T00:00:00Z"),
    latest = await backup(null, "SUCCEEDED", "2026-03-01T00:00:00Z");
  await repo.updatePolicy(
    {
      enabled: false,
      scope: "FULL_PLATFORM",
      frequency: "DAILY",
      executionTime: "02:00",
      timezone: "UTC",
      retentionCount: 1,
    },
    actor,
    randomUUID(),
  );
  const deletion = await request(latest.id);
  expect((await repo.retentionCandidates(middle.id)).map((r) => r.id)).toEqual([
    old.id,
  ]);
  await expect(request(old.id)).rejects.toMatchObject({
    code: "INVALID_STATE_TRANSITION",
  });
  await expect(request(middle.id)).rejects.toMatchObject({ code: "CONFLICT" });
  await repo.claimDeletion();
  await repo.checkDeletion(deletion.id, latest.key);
  await repo.markPruned(old.id, old.key);
  await repo.completeDeletion(deletion.id, latest.key);
  expect((await repo.detail(middle.id)).state).toBe("SUCCEEDED");
  expect(await repo.retryPruneCandidates()).toEqual([]);
});
it("serializes retention selection racing a manual request", async () => {
  await backup();
  const latest = await backup(null, "SUCCEEDED", "2026-04-01T00:00:00Z");
  await repo.updatePolicy(
    {
      enabled: false,
      scope: "FULL_PLATFORM",
      frequency: "DAILY",
      executionTime: "02:00",
      timezone: "UTC",
      retentionCount: 1,
    },
    actor,
    randomUUID(),
  );
  const results = await Promise.allSettled([
    request(latest.id),
    repo.retentionCandidates(latest.id),
  ]);
  expect(results[1]?.status).toBe("fulfilled");
  const survivors = await client.query(
    "SELECT id FROM platform_backup_jobs j WHERE state='SUCCEEDED' AND checksum_verified AND prune_authorized_by IS NULL AND NOT EXISTS(SELECT 1 FROM platform_backup_deletion_requests d WHERE d.backup_job_id=j.id AND d.state IN ('QUEUED','RUNNING'))",
  );
  expect(survivors.rows).toHaveLength(1);
});
it("rechecks target state and verification immediately before physical deletion", async () => {
  const target = await backup();
  await backup();
  const deletion = await request(target.id);
  await repo.claimDeletion();
  await client.query(
    "UPDATE platform_backup_jobs SET checksum_verified=false WHERE id=$1",
    [target.id],
  );
  await expect(
    repo.checkDeletion(deletion.id, target.key),
  ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  await client.query(
    "UPDATE platform_backup_jobs SET checksum_verified=true,state='FAILED' WHERE id=$1",
    [target.id],
  );
  await expect(
    repo.checkDeletion(deletion.id, target.key),
  ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  expect(
    (
      await client.query(
        "SELECT state FROM platform_backup_deletion_requests WHERE id=$1",
        [deletion.id],
      )
    ).rows[0].state,
  ).toBe("RUNNING");
});
