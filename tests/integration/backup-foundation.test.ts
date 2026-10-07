import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { expect, it } from "vitest";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";

if (existsSync(".env")) process.loadEnvFile(".env");
it("applies backup foundation and enforces control database constraints", async () => {
  const url = new URL(process.env.CONTROL_MIGRATION_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local PostgreSQL test only");
  const client = new Client({ connectionString: url.href });
  const schema = `backup_test_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
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
    expect(
      (
        await client.query(
          "SELECT version FROM eventos_schema_migrations WHERE version='0013_backup_foundation'",
        )
      ).rowCount,
    ).toBe(1);
    const policy =
      "INSERT INTO platform_backup_policies (frequency,execution_time,timezone,retention_count,updated_by,weekday) VALUES ($1,'02:30','Asia/Tehran',$2,'test',$3)";
    await client.query(policy, ["DAILY", 10, null]);
    await client.query(policy, ["WEEKLY", 100, 6]);
    for (const values of [
      ["DAILY", 0, null],
      ["DAILY", 101, null],
      ["WEEKLY", 10, null],
      ["WEEKLY", 10, 7],
      ["MONTHLY", 10, null],
    ])
      await expect(client.query(policy, values)).rejects.toMatchObject({
        code: "23514",
      });
    const plan = randomUUID(),
      tenant = randomUUID();
    await client.query(
      "INSERT INTO plans(id,code,name) VALUES ($1,'backup_test','Test')",
      [plan],
    );
    await client.query(
      "INSERT INTO tenants(id,slug,legal_name,display_name,plan_id,created_by) VALUES($1,'backup-test','Test','Test',$2,'test')",
      [tenant, plan],
    );
    const job =
      "INSERT INTO platform_backup_jobs(scope,tenant_id,trigger_type,state,request_id,backup_key,size_bytes) VALUES($1,$2,$3,$4,'test-request',$5,$6)";
    await client.query(job, [
      "FULL_PLATFORM",
      null,
      "MANUAL",
      "QUEUED",
      "backup-01",
      0,
    ]);
    await client.query(job, [
      "TENANT",
      tenant,
      "SCHEDULED",
      "SUCCEEDED",
      "backup-02",
      12,
    ]);
    for (const values of [
      ["INVALID", null, "MANUAL", "QUEUED", "safe", 0],
      ["TENANT", null, "MANUAL", "QUEUED", "safe", 0],
      ["FULL_PLATFORM", tenant, "MANUAL", "QUEUED", "safe", 0],
      ["FULL_PLATFORM", null, "MANUAL", "INVALID", "safe", 0],
      ["FULL_PLATFORM", null, "INVALID", "QUEUED", "safe", 0],
      ["FULL_PLATFORM", null, "MANUAL", "QUEUED", "safe", -1],
      ["FULL_PLATFORM", null, "MANUAL", "QUEUED", "/absolute/path", 0],
    ])
      await expect(client.query(job, values)).rejects.toMatchObject({
        code: "23514",
      });
    await expect(
      client.query("UPDATE platform_backup_policies SET scope='TENANT'"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query("UPDATE platform_backup_jobs SET safe_error_message=$1", [
        "x".repeat(501),
      ]),
    ).rejects.toMatchObject({ code: "22001" });
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
