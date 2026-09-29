import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { applyTenantPrismaMigrations } from "@/infrastructure/db/tenant/prisma-migrations";
import {
  closeTenantPools,
  getTenantPool,
} from "@/infrastructure/db/tenant/pool";
import {
  createProgram,
  updateProgram,
  transitionProgram,
  listPrograms,
  getProgram,
  createRun,
  listRuns,
  getRun,
  transitionRun,
  createSession,
  listSessions,
  getSession,
  createVenue,
  createRoom,
  getVenue,
  getRoom,
} from "@/modules/program-core/repository";
import { sessionInput } from "@/modules/program-core/schema";
import { enrollParticipant } from "@/modules/enrollment/repository";
import type { TenantContext } from "@/modules/tenant-identity/auth";

if (existsSync(".env")) process.loadEnvFile(".env");

type Fixture = {
  tenantId: string;
  databaseName: string;
  ownerId: string;
  instructorA: string;
  instructorB: string;
};
const fixtures: Fixture[] = [];
const day = 86_400_000;
const start = new Date(Date.now() + 20 * day);
const end = new Date(Date.now() + 80 * day);
function databaseUrl(base: string, name: string) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}
async function makeFixture(): Promise<Fixture> {
  const tenantId = randomUUID(),
    databaseName = `eventos_t_${tenantId.replaceAll("-", "")}`;
  const fixture = {
    tenantId,
    databaseName,
    ownerId: randomUUID(),
    instructorA: randomUUID(),
    instructorB: randomUUID(),
  };
  fixtures.push(fixture);
  const provisioner = new Client({
    connectionString: process.env.TENANT_PROVISIONING_DATABASE_URL,
  });
  await provisioner.connect();
  try {
    await provisioner.query(
      `CREATE DATABASE "${databaseName}" OWNER eventos_tenant_owner`,
    );
    await provisioner.query(
      `GRANT CONNECT ON DATABASE "${databaseName}" TO eventos_tenant_runtime,eventos_tenant_migrator`,
    );
  } finally {
    await provisioner.end();
  }
  const migration = new Client({
    connectionString: databaseUrl(
      process.env.TENANT_MIGRATION_DATABASE_URL ?? "",
      databaseName,
    ),
  });
  await migration.connect();
  try {
    await migration.query("SET ROLE eventos_tenant_owner");
    await applySqlMigrations(
      migration,
      path.join(
        process.cwd(),
        "src",
        "infrastructure",
        "db",
        "tenant",
        "migrations",
      ),
      `tenant-${tenantId}`,
    );
    await migration.query(
      "GRANT USAGE ON SCHEMA public TO eventos_tenant_runtime",
    );
    await migration.query(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO eventos_tenant_runtime",
    );
    await migration.query(
      "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO eventos_tenant_runtime",
    );
    await migration.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO eventos_tenant_runtime",
    );
    await migration.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO eventos_tenant_runtime",
    );
    await migration.query(
      "INSERT INTO tenant_metadata (tenant_id,slug,schema_version) VALUES ($1,$2,'0001_tenant_foundation')",
      [tenantId, `core-${tenantId.slice(0, 8)}`],
    );
    await migration.query(
      "INSERT INTO tenant_schema_migrations(version) VALUES ('0001_tenant_foundation')",
    );
  } finally {
    await migration.end();
  }
  await applyTenantPrismaMigrations(databaseName, tenantId);
  const pool = getTenantPool(fixture);
  for (const [id, name] of [
    [fixture.ownerId, "Owner"],
    [fixture.instructorA, "Instructor A"],
    [fixture.instructorB, "Instructor B"],
  ]) {
    await pool.query(
      `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status) VALUES ($1,$2,$3,$4,true,'ACTIVE')`,
      [id, tenantId, name, `${id}@example.test`],
    );
  }
  for (const id of [fixture.instructorA, fixture.instructorB])
    await pool.query(
      "INSERT INTO tenant_instructor_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,$3)",
      [
        tenantId,
        id,
        id === fixture.instructorA ? "Instructor A" : "Instructor B",
      ],
    );
  return fixture;
}
function scope(
  f: Fixture,
  userId = f.ownerId,
  permissions: string[] = [
    "program.read",
    "program.create",
    "program.update",
    "program.publish",
    "program.delete",
    "session.read",
    "session.manage",
    "settings.read",
    "settings.manage",
    "instructor.manage",
    "instructor.read",
  ],
) {
  return {
    tenant: { tenantId: f.tenantId, databaseName: f.databaseName },
    actor: {
      id: userId,
      email: `${userId}@example.test`,
      name: "Test actor",
      tenantId: f.tenantId,
      authenticationLevel: "PASSWORD",
      permissions: new Set(permissions),
    },
    requestId: randomUUID(),
  };
}
const programInput = {
  type: "WORKSHOP" as const,
  title: "Creative Writing",
  slug: "creative-writing",
  shortDescription: "Synthetic",
  description: "Synthetic",
  category: "Art",
  level: "Beginner",
  objectives: "Write",
  prerequisites: "None",
  intendedAudience: "Adults",
  defaultDurationMinutes: 120,
};
function runInput(programId: string, venueId: string, instructorId: string) {
  return {
    programId,
    title: "Autumn run",
    startsAt: start,
    endsAt: end,
    registrationStartsAt: null,
    registrationEndsAt: null,
    deliveryMode: "IN_PERSON" as const,
    capacity: 20,
    minimumCapacity: 5,
    waitlistEnabled: false,
    venueId,
    instructorIds: [instructorId],
    notes: "Synthetic",
  };
}
function sessionData(
  runId: string,
  roomId: string,
  instructorIds: string[],
  offset = 25,
) {
  const startsAt = new Date(Date.now() + offset * day),
    endsAt = new Date(startsAt.getTime() + 2 * 3600_000);
  return {
    runId,
    title: `Session ${offset}`,
    startsAt,
    endsAt,
    timezone: "Asia/Tehran",
    deliveryMode: "IN_PERSON" as const,
    venueId: null,
    roomId,
    instructorIds,
    notes: "Synthetic",
  };
}

describe("Phase 3 real PostgreSQL program core", () => {
  let a: Fixture,
    b: Fixture,
    programId = "",
    runId = "",
    sessionId = "",
    venueId = "",
    roomId = "",
    otherRoomId = "";
  beforeAll(async () => {
    const url = process.env.TENANT_PROVISIONING_DATABASE_URL;
    if (
      !url ||
      !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)
    )
      throw new Error(
        "Phase 3 integration tests require local disposable PostgreSQL.",
      );
    a = await makeFixture();
    b = await makeFixture();
  }, 120_000);
  afterAll(async () => {
    await closeTenantPools();
    if (fixtures.length === 0) return;
    const provisioner = new Client({
      connectionString: process.env.TENANT_PROVISIONING_DATABASE_URL,
    });
    await provisioner.connect();
    try {
      for (const fixture of fixtures)
        await provisioner.query(
          `DROP DATABASE IF EXISTS "${fixture.databaseName}"`,
        );
    } finally {
      await provisioner.end();
    }
  }, 30_000);

  it("migrates in place and audits program CRUD and state transitions", async () => {
    const s = scope(a);
    const program = await createProgram(s, programInput);
    programId = String(program.id);
    expect((await getProgram(s, programId)).title).toBe("Creative Writing");
    expect((await listPrograms(s)).some((row) => row.id === programId)).toBe(
      true,
    );
    await updateProgram(s, programId, {
      ...programInput,
      title: "Creative Writing Updated",
    });
    await transitionProgram(s, programId, "ACTIVE");
    expect((await getProgram(s, programId)).status).toBe("ACTIVE");
    const migration = await getTenantPool(a).query<{ version: string }>(
      "SELECT version FROM tenant_schema_migrations WHERE version='0006_phase4_self_registration_ids'",
    );
    expect(migration.rowCount).toBe(1);
    const audits = await getTenantPool(a).query<{ action: string }>(
      "SELECT action FROM tenant_audit_logs WHERE tenant_id=$1 AND target_id=$2",
      [a.tenantId, programId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["program.created", "program.updated"]),
    );
  });

  it("creates runs and sessions and rejects instructor, room and capacity conflicts", async () => {
    const s = scope(a);
    venueId = String(
      (
        await createVenue(s, {
          name: "Training centre",
          address: "Synthetic",
          city: "Isfahan",
          description: "",
          active: true,
        })
      ).id,
    );
    roomId = String(
      (
        await createRoom(s, {
          venueId,
          name: "Room 101",
          capacity: 25,
          description: "",
          active: true,
        })
      ).id,
    );
    otherRoomId = String(
      (
        await createRoom(s, {
          venueId,
          name: "Room 202",
          capacity: 25,
          description: "",
          active: true,
        })
      ).id,
    );
    runId = String(
      (await createRun(s, runInput(programId, venueId, a.instructorA))).id,
    );
    sessionId = String(
      (await createSession(s, sessionData(runId, roomId, [a.instructorA]))).id,
    );
    await transitionRun(s, runId, "PUBLISHED");
    expect((await listSessions(s)).some((row) => row.id === sessionId)).toBe(
      true,
    );
    const instructorScope = scope(a, a.instructorA, [
      "program.read",
      "session.read",
    ]);
    expect(
      (await listRuns(instructorScope)).some((row) => row.id === runId),
    ).toBe(true);
    expect(
      (await listSessions(instructorScope)).some((row) => row.id === sessionId),
    ).toBe(true);
    const unrelated = scope(a, a.instructorB, ["program.read", "session.read"]);
    expect(
      (await listSessions(unrelated)).some((row) => row.id === sessionId),
    ).toBe(false);
    await expect(getSession(unrelated, sessionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getRun(unrelated, runId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      createSession(s, sessionData(runId, otherRoomId, [a.instructorA])),
    ).rejects.toMatchObject({ message: "INSTRUCTOR_SCHEDULE_CONFLICT" });
    await expect(
      createSession(s, sessionData(runId, roomId, [a.instructorB])),
    ).rejects.toMatchObject({ message: "ROOM_SCHEDULE_CONFLICT" });
    const smallRoom = String(
      (
        await createRoom(s, {
          venueId,
          name: "Small",
          capacity: 5,
          description: "",
          active: true,
        })
      ).id,
    );
    await expect(
      createSession(s, sessionData(runId, smallRoom, [a.instructorB], 35)),
    ).rejects.toMatchObject({ message: "ROOM_CAPACITY_CONFLICT" });
    expect(
      sessionInput.safeParse({
        ...sessionData(runId, roomId, [a.instructorA]),
        startsAt: new Date(),
        endsAt: new Date(0),
      }).success,
    ).toBe(false);
  });

  it("serializes concurrent room reservations", async () => {
    const s = scope(a);
    const [first, second] = await Promise.allSettled([
      createSession(s, sessionData(runId, roomId, [a.instructorA], 45)),
      createSession(s, sessionData(runId, roomId, [a.instructorB], 45)),
    ]);
    expect(
      [first, second].filter((item) => item.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      [first, second].filter((item) => item.status === "rejected"),
    ).toHaveLength(1);
  });

  it("rejects cross-tenant program, run, session, instructor, venue and room IDs", async () => {
    const s = scope(a),
      other = scope(b);
    await expect(getProgram(other, programId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getRun(other, runId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getSession(other, sessionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getVenue(other, venueId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getRoom(other, roomId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      createRun(s, runInput(programId, venueId, b.instructorA)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createRun(other, runInput(programId, venueId, b.instructorA)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createSession(s, sessionData(runId, roomId, [b.instructorA], 55)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await listPrograms(other)).some((row) => row.id === programId),
    ).toBe(false);
    expect((await listRuns(other)).some((row) => row.id === runId)).toBe(false);
    expect(
      (await listSessions(other)).some((row) => row.id === sessionId),
    ).toBe(false);
  });

  it("locks capacity during concurrent registrations and isolates enrollment by tenant", async () => {
    const s = scope(a);
    const startsAt = new Date(Date.now() + 100 * day);
    const endsAt = new Date(startsAt.getTime() + day);
    const run = await createRun(s, {
      ...runInput(programId, venueId, a.instructorA),
      startsAt,
      endsAt,
      capacity: 1,
      minimumCapacity: null,
      waitlistEnabled: true,
      deliveryMode: "ONLINE",
      venueId: null,
    });
    const capacityRunId = String(run.id);
    await createSession(s, {
      runId: capacityRunId,
      title: "Capacity test session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      timezone: "Asia/Tehran",
      deliveryMode: "ONLINE",
      venueId: null,
      roomId: null,
      instructorIds: [a.instructorA],
      notes: "Synthetic",
    });
    await transitionRun(s, capacityRunId, "PUBLISHED");
    const ids = [randomUUID(), randomUUID()];
    const firstParticipantId = ids[0];
    if (!firstParticipantId)
      throw new Error("Participant fixture was not created.");
    for (const id of ids) {
      await getTenantPool(a).query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status)
         VALUES ($1,$2,'Participant',$3,true,'ACTIVE')`,
        [id, a.tenantId, `${id}@example.test`],
      );
      await getTenantPool(a).query(
        `INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name)
         VALUES ($1,$2,'Participant')`,
        [a.tenantId, id],
      );
    }
    const tenant = {
      tenantId: a.tenantId,
      databaseName: a.databaseName,
      features: {
        registration: true,
        courses: true,
        events: true,
        waitlist: true,
      },
    } as TenantContext;
    const enrollmentScope = (id: string) => ({
      tenant,
      actor: {
        id,
        tenantId: a.tenantId,
        email: `${id}@example.test`,
        name: "Participant",
        authenticationLevel: "PASSWORD",
        permissions: new Set<string>(),
      },
      requestId: randomUUID(),
    });
    const results = await Promise.all(
      ids.map((id) =>
        enrollParticipant(enrollmentScope(id), capacityRunId, {}),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      "CONFIRMED",
      "WAITLISTED",
    ]);
    const rows = await getTenantPool(a).query<{ status: string }>(
      `SELECT status FROM enrollments WHERE tenant_id=$1 AND run_id=$2`,
      [a.tenantId, capacityRunId],
    );
    expect(rows.rows.filter((row) => row.status === "CONFIRMED")).toHaveLength(
      1,
    );
    await expect(
      enrollParticipant(enrollmentScope(firstParticipantId), capacityRunId, {}),
    ).rejects.toMatchObject({ code: "ALREADY_ENROLLED" });
    const wrongTenant = {
      ...enrollmentScope(firstParticipantId),
      tenant: { ...tenant, tenantId: b.tenantId, databaseName: b.databaseName },
      actor: {
        ...enrollmentScope(firstParticipantId).actor,
        tenantId: b.tenantId,
      },
    };
    await expect(
      enrollParticipant(wrongTenant, capacityRunId, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      enrollParticipant(
        {
          ...enrollmentScope(firstParticipantId),
          tenant: {
            ...tenant,
            features: { ...tenant.features, registration: false },
          },
        },
        capacityRunId,
        {},
      ),
    ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });
});
