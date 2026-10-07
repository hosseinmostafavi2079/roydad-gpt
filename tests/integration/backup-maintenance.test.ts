import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { expect, it } from "vitest";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { BackupRepository } from "@/modules/platform/backups/repository";

if (existsSync(".env")) process.loadEnvFile(".env");
it("singleton policy, concurrent due scheduling, safe audit, grouped retention and authorized prune", async () => {
  const url = new URL(process.env.CONTROL_MIGRATION_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local test only");
  const schema = `backup_maintenance_${randomUUID().replaceAll("-", "")}`,
    client = new Client({ connectionString: url.href });
  await client.connect();
  const pool = new Pool({
    connectionString: url.href,
    options: `-c search_path=${schema},public`,
  });
  try {
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
    const repo = new BackupRepository(pool),
      now = new Date("2026-10-07T12:00:00Z");
    const defaults = await Promise.all([repo.policy(), repo.policy()]);
    expect(defaults[0]?.id).toBe(defaults[1]?.id);
    expect(defaults[0]?.enabled).toBe(false);
    expect(await repo.enqueueDueScheduledBackup(now)).toBeNull();
    const input = {
      enabled: true,
      scope: "FULL_PLATFORM" as const,
      frequency: "DAILY" as const,
      executionTime: "02:00",
      timezone: "UTC",
      retentionCount: 2,
    };
    await repo.updatePolicy(input, "admin", randomUUID(), now);
    expect(await repo.enqueueDueScheduledBackup(now)).toBeNull();
    await client.query(
      "UPDATE platform_backup_policies SET next_run_at='2020-01-01'",
    );
    const due = await Promise.all([
      repo.enqueueDueScheduledBackup(now),
      repo.enqueueDueScheduledBackup(now),
    ]);
    expect(due.filter(Boolean)).toHaveLength(1);
    expect(due.find(Boolean)?.triggerType).toBe("SCHEDULED");
    expect((await repo.policy()).nextRunAt?.getTime()).toBeGreaterThan(
      now.getTime(),
    );
    expect(
      (await client.query("SELECT count(*)::int n FROM platform_backup_jobs"))
        .rows[0].n,
    ).toBe(1);
    expect((await repo.claim())?.triggerType).toBe("SCHEDULED");
    const first = due.find(Boolean);
    if (!first) throw new Error("Missing due job");
    await repo.transition(first.id, "FAILED");
    await repo.updatePolicy(
      { ...input, frequency: "WEEKLY", weekday: 3 },
      "admin",
      randomUUID(),
      now,
    );
    await client.query(
      "UPDATE platform_backup_policies SET next_run_at='2020-01-01'",
    );
    expect(await repo.enqueueDueScheduledBackup(now)).not.toBeNull();
    const audit = (
      await client.query(
        "SELECT before_state,after_state FROM platform_audit_logs WHERE action='backup.policy_updated'",
      )
    ).rows;
    for (const row of audit)
      for (const state of [row.before_state, row.after_state])
        expect(Object.keys(state).sort()).toEqual([
          "enabled",
          "executionTime",
          "frequency",
          "retentionCount",
          "timezone",
          "weekday",
        ]);
    const plan = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await client.query(
      "INSERT INTO plans(id,code,name)VALUES($1,'maintenance','Test')",
      [plan],
    );
    for (const [id, slug] of [
      [a, "maintenance-a"],
      [b, "maintenance-b"],
    ] as const)
      await client.query(
        "INSERT INTO tenants(id,slug,legal_name,display_name,plan_id,created_by)VALUES($1,$2,$2,$2,$3,'test')",
        [id, slug, plan],
      );
    async function job(
      tenant: string | null,
      state = "SUCCEEDED",
      time = "2026-01-01T00:00:00Z",
    ) {
      const id = randomUUID();
      await client.query(
        "INSERT INTO platform_backup_jobs(id,scope,tenant_id,trigger_type,state,request_id,backup_key,checksum_verified,completed_at,created_at)VALUES($1,$2,$3,'MANUAL',$4,$5,$6,$7,$8,$8)",
        [
          id,
          tenant ? "TENANT" : "FULL_PLATFORM",
          tenant,
          state,
          randomUUID(),
          `eventos-20260101T000000Z-${id}`,
          state === "SUCCEEDED",
          time,
        ],
      );
      return id;
    }
    const old: string[] = [];
    for (let index = 0; index < 4; index++) old.push(await job(null));
    const current = await job(null, "SUCCEEDED", "2026-10-07T12:00:00Z");
    const failed = await job(null, "FAILED"),
      running = await job(null, "RUNNING"),
      verifying = await job(null, "VERIFYING");
    for (const id of [failed, running, verifying])
      expect(await repo.retentionCandidates(id)).toEqual([]);
    const candidates = await repo.retentionCandidates(current);
    const kept = old.sort().at(-1);
    expect(candidates.map((row) => row.id).sort()).toEqual(
      old.filter((id) => id !== kept).sort(),
    );
    expect(candidates.map((row) => row.id)).not.toContain(current);
    const aOld = await job(a),
      aMid = await job(a, "SUCCEEDED", "2026-02-01T00:00:00Z"),
      aCurrent = await job(a, "SUCCEEDED", "2026-10-07T12:00:00Z");
    const bOld = await job(b),
      bMid = await job(b, "SUCCEEDED", "2026-02-01T00:00:00Z"),
      bCurrent = await job(b, "SUCCEEDED", "2026-10-07T12:00:00Z");
    expect(
      (await repo.retentionCandidates(aCurrent)).map((row) => row.id),
    ).toEqual([aOld]);
    expect(
      (await repo.retentionCandidates(bCurrent)).map((row) => row.id),
    ).toEqual([bOld]);
    for (const id of [aMid, bMid, current])
      expect(
        (await repo.retryPruneCandidates()).map((row) => row.id),
      ).not.toContain(id);
    await expect(
      repo.markPruned(current, `eventos-20260101T000000Z-${current}`),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    const selected = candidates[0];
    if (!selected) throw new Error("Missing candidate");
    expect(
      (await repo.checkPruneCandidate(selected.id, selected.backupKey)).id,
    ).toBe(selected.id);
    // Failed physical deletion does not invoke DB marking: authorization remains retriable.
    expect((await repo.detail(selected.id)).state).toBe("SUCCEEDED");
    await repo.updatePolicy(
      { ...input, retentionCount: 100 },
      "admin",
      randomUUID(),
      now,
    );
    await expect(
      repo.checkPruneCandidate(selected.id, selected.backupKey),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await repo.updatePolicy(input, "admin", randomUUID(), now);
    expect((await repo.markPruned(selected.id, selected.backupKey)).state).toBe(
      "PRUNED",
    );
    expect((await repo.markPruned(selected.id, selected.backupKey)).state).toBe(
      "PRUNED",
    );
    expect(
      (await repo.retryPruneCandidates()).map((row) => row.id),
    ).not.toContain(selected.id);
    expect(
      (
        await client.query(
          "SELECT count(*)::int n FROM platform_audit_logs WHERE action='backup.pruned'",
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await pool.end();
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
