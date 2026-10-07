import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { expect, it } from "vitest";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { BackupRepository } from "@/modules/platform/backups/repository";
if (existsSync(".env")) process.loadEnvFile(".env");
it("manual queue, atomic claim, safe transitions, audits and isolated metadata", async () => {
  const url = new URL(process.env.CONTROL_MIGRATION_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local test only");
  const schema = `manual_backup_${randomUUID().replaceAll("-", "")}`,
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
    const repo = new BackupRepository(pool),
      requestId = randomUUID(),
      plan = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await client.query(
      "INSERT INTO plans(id,code,name)VALUES($1,'backup','Backup')",
      [plan],
    );
    for (const [id, slug] of [
      [a, "tenant-a"],
      [b, "tenant-b"],
    ] as const) {
      await client.query(
        "INSERT INTO tenants(id,slug,legal_name,display_name,plan_id,created_by,metadata)VALUES($1,$2,$2,$2,$3,'test',$4)",
        [id, slug, plan, { privateSecret: "never-export" }],
      );
      await client.query(
        "INSERT INTO tenant_database_registry(tenant_id,database_name)VALUES($1,$2)",
        [id, `eventos_t_${id.replaceAll("-", "")}`],
      );
    }
    await expect(
      repo.enqueue(
        { scope: "TENANT", tenantId: randomUUID() },
        "admin",
        requestId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const full = await repo.enqueue(
      { scope: "FULL_PLATFORM" },
      "admin",
      requestId,
    );
    const claims = await Promise.all([repo.claim(), repo.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.id).toBe(full.id);
    await expect(
      repo.transition(full.id, "SUCCEEDED", {
        backupKey: "safe",
        sizeBytes: "1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await repo.transition(full.id, "VERIFYING");
    const done = await repo.transition(full.id, "SUCCEEDED", {
      backupKey: "eventos-safe",
      sizeBytes: "123",
    });
    expect(done.checksumVerified).toBe(true);
    expect(done.completedAt).not.toBeNull();
    await expect(repo.transition(full.id, "FAILED")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    const tenant = await repo.enqueue(
      { scope: "TENANT", tenantId: a },
      "admin",
      randomUUID(),
    );
    await repo.claim();
    await repo.transition(tenant.id, "VERIFYING");
    const failed = await repo.transition(tenant.id, "FAILED");
    expect(failed.checksumVerified).toBe(false);
    expect(failed.errorCode).toBe("BACKUP_FAILED");
    expect(failed.errorMessage).toBe(
      "Backup execution or verification failed.",
    );
    const runningFailure = await repo.enqueue(
      { scope: "FULL_PLATFORM" },
      "admin",
      randomUUID(),
    );
    await repo.claim();
    await repo.transition(runningFailure.id, "FAILED");
    expect(await repo.claim()).toBeNull();
    const metadata = await repo.tenantMetadata(a);
    expect(JSON.stringify(metadata)).not.toContain(b);
    expect(JSON.stringify(metadata)).not.toContain("privateSecret");
    expect(JSON.stringify(metadata)).not.toContain("never-export");
    expect(Object.keys(metadata).sort()).toEqual([
      "branding",
      "domains",
      "features",
      "limits",
      "plan",
      "registry",
      "tenant",
    ]);
    expect((metadata.tenant as { id: string }).id).toBe(a);
    const safe = await repo.detail(tenant.id);
    expect(Object.keys(safe)).not.toContain("requested_by");
    expect(JSON.stringify(await repo.list(10, 0))).not.toContain(
      "databaseName",
    );
    const actions = (
      await client.query(
        "SELECT action,after_state FROM platform_audit_logs ORDER BY created_at",
      )
    ).rows;
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "backup.manual_requested",
        "backup.started",
        "backup.succeeded",
        "backup.failed",
      ]),
    );
    for (const row of actions)
      expect(Object.keys(row.after_state).sort()).toEqual([
        "jobId",
        "scope",
        "state",
        "tenantId",
      ]);
    // Corrupt the registry only inside the disposable schema to prove independent runtime validation.
    await client.query(
      "ALTER TABLE tenant_database_registry DROP CONSTRAINT tenant_database_name_format",
    );
    await client.query(
      "UPDATE tenant_database_registry SET database_name='unsafe' WHERE tenant_id=$1",
      [a],
    );
    await expect(repo.tenantMetadata(a)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  } finally {
    await pool.end();
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
