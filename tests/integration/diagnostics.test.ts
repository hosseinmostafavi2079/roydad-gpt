import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { expect, it } from "vitest";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { BackupRepository } from "@/modules/platform/backups/repository";
import { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";

if (existsSync(".env")) process.loadEnvFile(".env");
it("diagnostics migrations, constraints, concurrent incident correlation, recovery, safe export and backup instrumentation", async () => {
  const url = new URL(process.env.CONTROL_MIGRATION_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local test only");
  const schema = `diagnostics_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: url.href });
  await client.connect();
  const pool = new Pool({
    connectionString: url.href,
    options: `-c search_path=${schema},public`,
  });
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}",public`);
    const migrations = path.resolve("src/infrastructure/db/control/migrations");
    await applySqlMigrations(client, migrations, schema);
    await applySqlMigrations(client, migrations, schema);
    const repo = new DiagnosticsRepository(pool),
      requestId = randomUUID();
    const failure = {
      code: "BACKUP_FAILED" as const,
      requestId,
      metadata: { scope: "FULL_PLATFORM", errorCode: "BACKUP_FAILED" },
    };
    const first = await repo.recordOperationalFailure(failure);
    expect(first.status).toBe("OPEN");
    expect(first.occurrenceCount).toBe("1");
    const repeated = await Promise.all([
      repo.recordOperationalFailure(failure),
      repo.recordOperationalFailure(failure),
    ]);
    expect(repeated.every((value) => value.id === first.id)).toBe(true);
    expect((await repo.getIncident(first.id)).occurrenceCount).toBe("3");
    expect(
      await repo.listDiagnosticEvents({ incidentId: first.id }),
    ).toHaveLength(1);
    await repo.recordOperationalRecovery(failure);
    expect((await repo.getIncident(first.id)).status).toBe("RECOVERED");
    const recurrence = await repo.recordOperationalFailure(failure);
    expect(recurrence.id).not.toBe(first.id);
    const plan = (
      await client.query<{ id: string }>(
        "INSERT INTO plans(code,name) VALUES('diagnostics','Test') RETURNING id",
      )
    ).rows[0]?.id;
    const tenantA = randomUUID(),
      tenantB = randomUUID();
    for (const [index, id] of [tenantA, tenantB].entries())
      await client.query(
        "INSERT INTO tenants(id,slug,legal_name,display_name,plan_id,created_by) VALUES($1,$2,'Test','Test',$3,'test')",
        [id, `diag-${index}`, plan],
      );
    const a = await repo.recordOperationalFailure({
      code: "TENANT_PROVISIONING_FAILED",
      tenantId: tenantA,
      relatedJobId: randomUUID(),
      requestId,
      metadata: { phase: "VERIFYING", errorCode: "FAILED_VERIFICATION" },
    });
    const b = await repo.recordOperationalFailure({
      code: "TENANT_PROVISIONING_FAILED",
      tenantId: tenantB,
      requestId,
    });
    expect(a.id).not.toBe(b.id);
    expect(await repo.listIncidents({ tenantId: tenantA })).toHaveLength(1);
    const standalone = {
      code: "SMS_PROVIDER_TIMEOUT" as const,
      metadata: { retryable: true },
    };
    await Promise.all([
      repo.recordDiagnosticEvent(standalone),
      repo.recordDiagnosticEvent(standalone),
    ]);
    expect(await repo.listDiagnosticEvents({ component: "SMS" })).toHaveLength(
      1,
    );
    expect(
      await repo.listIncidents({ status: "OPEN", requestId }),
    ).toHaveLength(3);
    await repo.upsertComponentHeartbeat("MAIN_WORKER");
    const initialHeartbeat = (
      await client.query<{ last_seen_at: Date }>(
        "SELECT last_seen_at FROM platform_component_heartbeats WHERE component='MAIN_WORKER'",
      )
    ).rows[0]?.last_seen_at;
    await repo.upsertComponentHeartbeat("MAIN_WORKER");
    expect(
      (
        await client.query<{ last_seen_at: Date }>(
          "SELECT last_seen_at FROM platform_component_heartbeats WHERE component='MAIN_WORKER'",
        )
      ).rows[0]?.last_seen_at,
    ).toEqual(initialHeartbeat);
    expect(
      (await client.query("SELECT * FROM platform_component_heartbeats"))
        .rowCount,
    ).toBe(1);
    let summary = await repo.getDiagnosticsSummary();
    expect(
      summary.components.find((value) => value.component === "MAIN_WORKER")
        ?.status,
    ).toBe("HEALTHY");
    expect(
      summary.components.find((value) => value.component === "BACKUP_RUNNER")
        ?.status,
    ).toBe("UNKNOWN");
    await client.query(
      "UPDATE platform_component_heartbeats SET last_seen_at=now()-interval '4 minutes'",
    );
    summary = await repo.getDiagnosticsSummary();
    expect(
      summary.components.find((value) => value.component === "MAIN_WORKER")
        ?.status,
    ).toBe("DEGRADED");
    await client.query(
      "UPDATE platform_component_heartbeats SET last_seen_at=now()-interval '6 minutes'",
    );
    summary = await repo.getDiagnosticsSummary();
    expect(
      summary.components.find((value) => value.component === "MAIN_WORKER")
        ?.status,
    ).toBe("UNAVAILABLE");
    const exported = await repo.exportIncident(a.id);
    expect(exported.incident.troubleshooting.length).toBeGreaterThan(0);
    expect(exported.events[0]?.metadata).toEqual({
      phase: "VERIFYING",
      errorCode: "FAILED_VERIFICATION",
    });
    // A historical malformed DB field cannot become secret-bearing export text.
    await client.query(
      "UPDATE platform_incidents SET summary='password=do-not-export',probable_cause='raw SQL' WHERE id=$1",
      [a.id],
    );
    await client.query(
      "UPDATE platform_diagnostic_events SET safe_message='stack trace',safe_metadata='{\"token\":\"do-not-export\"}' WHERE incident_id=$1",
      [a.id],
    );
    expect(JSON.stringify(await repo.exportIncident(a.id))).not.toMatch(
      /do-not-export|raw SQL|stack trace/,
    );
    await expect(repo.getIncident(randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const [sql, args] of [
      ["UPDATE platform_incidents SET severity='HIGH' WHERE id=$1", [a.id]],
      ["UPDATE platform_incidents SET status='CLOSED' WHERE id=$1", [a.id]],
      ["UPDATE platform_incidents SET occurrence_count=0 WHERE id=$1", [a.id]],
      [
        "UPDATE platform_diagnostic_events SET safe_metadata='[]' WHERE incident_id=$1",
        [a.id],
      ],
      [
        "UPDATE platform_diagnostic_events SET incident_id=$2 WHERE incident_id=$1",
        [a.id, randomUUID()],
      ],
      [
        "UPDATE platform_incidents SET component='invalid-component' WHERE id=$1",
        [a.id],
      ],
      [
        "UPDATE platform_incidents SET summary=$2 WHERE id=$1",
        [a.id, "x".repeat(501)],
      ],
      [
        "UPDATE platform_diagnostic_events SET safe_metadata=$2::jsonb WHERE incident_id=$1",
        [a.id, JSON.stringify({ value: "x".repeat(5000) })],
      ],
      [
        "UPDATE platform_incidents SET tenant_id=$2 WHERE id=$1",
        [a.id, randomUUID()],
      ],
    ] as [string, string[]][])
      await expect(client.query(sql, args)).rejects.toThrow();
    const backups = new BackupRepository(pool);
    const queued = await backups.enqueue(
      { scope: "FULL_PLATFORM" },
      "test",
      randomUUID(),
    );
    await backups.claim();
    await backups.transition(queued.id, "VERIFYING");
    await backups.transition(queued.id, "FAILED");
    expect(
      (await repo.listIncidents({ component: "BACKUP_SYSTEM" })).some(
        (value) => value.eventCode === "BACKUP_VERIFY_FAILED",
      ),
    ).toBe(true);
    const succeeded = await backups.enqueue(
      { scope: "FULL_PLATFORM" },
      "test",
      randomUUID(),
    );
    await backups.claim();
    await backups.transition(succeeded.id, "VERIFYING");
    await backups.transition(succeeded.id, "SUCCEEDED", {
      backupKey: `eventos-20261007T120000Z-${succeeded.id}`,
      sizeBytes: "1",
    });
    expect(
      await repo.listIncidents({ component: "BACKUP_SYSTEM", status: "OPEN" }),
    ).toHaveLength(0);
    await repo.recordOperationalRecovery(failure);
    const job = await backups.enqueue(
      { scope: "FULL_PLATFORM" },
      "test",
      randomUUID(),
    );
    await backups.claim();
    await backups.transition(job.id, "FAILED");
    expect(
      (await repo.listDiagnosticEvents({ component: "BACKUP_SYSTEM" })).some(
        (value) => value.relatedJobId === job.id,
      ),
    ).toBe(true);
    // Unavailable diagnostic tables must not roll back the backup failure transition.
    await client.query(
      "ALTER TABLE platform_incidents RENAME TO diagnostic_unavailable_fixture",
    );
    const interrupted = await backups.enqueue(
      { scope: "FULL_PLATFORM" },
      "test",
      randomUUID(),
    );
    await backups.claim();
    expect((await backups.transition(interrupted.id, "FAILED")).state).toBe(
      "FAILED",
    );
  } finally {
    await pool.end();
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
});
