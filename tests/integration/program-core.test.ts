import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { getControlPool } from "@/infrastructure/db/control/pool";
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
import { applyCoupon, createCoupon } from "@/modules/payments/coupons";
import {
  encryptProviderConfig,
  saveProviderConfiguration,
  setProviderEnabled,
} from "@/modules/payments/configuration";
import { refundPayment } from "@/modules/payments/refunds";
import { expirePaymentReservations } from "@/modules/payments/lifecycle";
import {
  getInvoiceForDownload,
  getOwnPayment,
} from "@/modules/payments/finance";
import { registerPaymentProviderForTests } from "@/modules/payments/registry";
import {
  reconcileUnresolvedPayments,
  startPaymentAttempt,
  verifyPaymentAttempt,
} from "@/modules/payments/service";
import {
  checkInWithQr,
  getSessionAttendance,
  issueAttendanceQr,
  listOwnAttendance,
  markAttendanceBatch,
} from "@/modules/attendance/repository";
import {
  getCertificatePdf,
  issueCertificate,
  listCertificates,
  revokeCertificate,
  saveTemplate,
  verifyCertificate,
} from "@/modules/certificates/repository";
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
    priceAmount: 0,
    priceCurrency: "IRR",
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
    const migration = await getTenantPool(a).query<{ schema_version: string }>(
      "SELECT schema_version FROM tenant_metadata WHERE tenant_id=$1 AND schema_version='0011_phase6_payment_lifecycle'",
      [a.tenantId],
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

  it("creates a trusted payment snapshot and reserves paid capacity", async () => {
    const s = scope(a);
    const startsAt = new Date(Date.now() + 120 * day);
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
    const paidRunId = String(run.id);
    await createSession(s, {
      runId: paidRunId,
      title: "Paid test session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      timezone: "Asia/Tehran",
      deliveryMode: "ONLINE",
      venueId: null,
      roomId: null,
      instructorIds: [a.instructorA],
      notes: "Synthetic",
    });
    await getTenantPool(a).query(
      "UPDATE program_runs SET price_amount=2500,price_currency='IRR' WHERE tenant_id=$1 AND id=$2",
      [a.tenantId, paidRunId],
    );
    await transitionRun(s, paidRunId, "PUBLISHED");
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await getTenantPool(a).query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status)
         VALUES ($1,$2,'Paid Participant',$3,true,'ACTIVE')`,
        [id, a.tenantId, `${id}@example.test`],
      );
      await getTenantPool(a).query(
        "INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,'Paid Participant')",
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
        payments: true,
      },
    } as TenantContext;
    const enroll = (id: string) =>
      enrollParticipant(
        {
          tenant,
          actor: {
            id,
            tenantId: a.tenantId,
            email: `${id}@example.test`,
            name: "Paid Participant",
            authenticationLevel: "PASSWORD",
            permissions: new Set<string>(),
          },
          requestId: randomUUID(),
        },
        paidRunId,
        {},
      );
    const firstId = ids[0];
    const secondId = ids[1];
    if (!firstId || !secondId)
      throw new Error("Participant fixture is incomplete.");
    const first = await enroll(firstId);
    const second = await enroll(secondId);
    expect(first.status).toBe("AWAITING_PAYMENT");
    expect(second.status).toBe("WAITLISTED");
    const snapshot = await getTenantPool(a).query<{
      original_amount: string;
      payable_amount: string;
      currency: string;
    }>(
      "SELECT original_amount,payable_amount,currency FROM payments WHERE tenant_id=$1 AND enrollment_id=$2",
      [a.tenantId, first.id],
    );
    expect(snapshot.rows[0]).toMatchObject({
      original_amount: "2500",
      payable_amount: "2500",
      currency: "IRR",
    });
  });

  it("reserves a limited coupon once under concurrent paid checkouts", async () => {
    const s = scope(a);
    const startsAt = new Date(Date.now() + 140 * day);
    const endsAt = new Date(startsAt.getTime() + day);
    const run = await createRun(s, {
      ...runInput(programId, venueId, a.instructorA),
      startsAt,
      endsAt,
      capacity: 2,
      minimumCapacity: null,
      waitlistEnabled: false,
      deliveryMode: "ONLINE",
      venueId: null,
      priceAmount: 10_000,
      priceCurrency: "IRR",
    });
    const paidRunId = String(run.id);
    await createSession(s, {
      runId: paidRunId,
      title: "Coupon test session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      timezone: "Asia/Tehran",
      deliveryMode: "ONLINE",
      venueId: null,
      roomId: null,
      instructorIds: [a.instructorA],
      notes: "Synthetic",
    });
    await transitionRun(s, paidRunId, "PUBLISHED");
    const tenant = {
      tenantId: a.tenantId,
      databaseName: a.databaseName,
      features: {
        registration: true,
        courses: true,
        events: true,
        waitlist: false,
        payments: true,
      },
    } as TenantContext;
    const couponScope = {
      tenant,
      actor: { ...s.actor, permissions: new Set(["payment.manage"]) },
      requestId: randomUUID(),
    };
    const coupon = await createCoupon(couponScope, {
      code: `LIMIT${randomUUID().slice(0, 8).toUpperCase()}`,
      discountType: "FIXED",
      discountValue: 1500n,
      currency: "IRR",
      maxUses: 1,
      startsAt: null,
      endsAt: null,
    });
    const enrollments = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      await getTenantPool(a).query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status)
         VALUES ($1,$2,'Coupon Participant',$3,true,'ACTIVE')`,
        [id, a.tenantId, `${id}@example.test`],
      );
      await getTenantPool(a).query(
        "INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,'Coupon Participant')",
        [a.tenantId, id],
      );
      const participantScope = {
        tenant,
        actor: {
          id,
          tenantId: a.tenantId,
          email: `${id}@example.test`,
          name: "Coupon Participant",
          authenticationLevel: "PASSWORD",
          permissions: new Set<string>(),
        },
        requestId: randomUUID(),
      };
      const enrollment = await enrollParticipant(
        participantScope,
        paidRunId,
        {},
      );
      enrollments.push({ participantScope, enrollment });
    }
    const results = await Promise.allSettled(
      enrollments.map(({ participantScope, enrollment }) => {
        if (!enrollment.id)
          throw new Error("Enrollment fixture is incomplete.");
        return applyCoupon(participantScope, enrollment.id, coupon.code);
      }),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const reservations = await getTenantPool(a).query<{ count: number }>(
      "SELECT count(*)::int AS count FROM coupon_reservations WHERE tenant_id=$1 AND coupon_id=$2 AND status='ACTIVE'",
      [a.tenantId, coupon.id],
    );
    expect(reservations.rows[0]?.count).toBe(1);
    const rejectedIndex = results.findIndex(
      (result) => result.status === "rejected",
    );
    const unpaid = enrollments[rejectedIndex];
    if (!unpaid?.enrollment.id)
      throw new Error("Unpaid enrollment fixture is missing.");
    const fullCoupon = await createCoupon(couponScope, {
      code: `FULL${randomUUID().slice(0, 8).toUpperCase()}`,
      discountType: "FIXED",
      discountValue: 10_000n,
      currency: "IRR",
      maxUses: 1,
      startsAt: null,
      endsAt: null,
    });
    const fullyDiscounted = await applyCoupon(
      unpaid.participantScope,
      unpaid.enrollment.id,
      fullCoupon.code,
    );
    expect(fullyDiscounted).toMatchObject({
      payableAmount: "0",
      status: "CONFIRMED",
    });
    const fullInvoice = await getTenantPool(a).query<{ count: number }>(
      `SELECT count(*)::int AS count FROM invoices i JOIN payments p ON p.tenant_id=i.tenant_id AND p.id=i.payment_id
       WHERE i.tenant_id=$1 AND p.enrollment_id=$2`,
      [a.tenantId, unpaid.enrollment.id],
    );
    expect(fullInvoice.rows[0]?.count).toBe(1);
  });

  it("verifies TEST attempts, preserves retries, issues one invoice, and refunds without crossing tenants", async () => {
    const control = getControlPool();
    await control.query(
      `INSERT INTO tenants (id,slug,legal_name,display_name,status,plan_id,created_by)
       SELECT $1,$2,'Payment Fixture','Payment Fixture','ACTIVE',id,$3 FROM plans WHERE code='foundation'`,
      [a.tenantId, `pay-${a.tenantId.slice(0, 8)}`, randomUUID()],
    );
    try {
      await control.query(
        `INSERT INTO tenant_payment_provider_allowlist (tenant_id,provider_key,allowed)
         VALUES ($1,'TEST',true)`,
        [a.tenantId],
      );
      const s = scope(a);
      const startsAt = new Date(Date.now() + 160 * day);
      const endsAt = new Date(startsAt.getTime() + day);
      const run = await createRun(s, {
        ...runInput(programId, venueId, a.instructorA),
        startsAt,
        endsAt,
        capacity: 1,
        minimumCapacity: null,
        waitlistEnabled: false,
        deliveryMode: "ONLINE",
        venueId: null,
        priceAmount: 5000,
        priceCurrency: "IRR",
      });
      const paidRunId = String(run.id);
      await createSession(s, {
        runId: paidRunId,
        title: "Payment test session",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        timezone: "Asia/Tehran",
        deliveryMode: "ONLINE",
        venueId: null,
        roomId: null,
        instructorIds: [a.instructorA],
        notes: "Synthetic",
      });
      await transitionRun(s, paidRunId, "PUBLISHED");
      const participantId = randomUUID();
      await getTenantPool(a).query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status)
         VALUES ($1,$2,'Payment Participant',$3,true,'ACTIVE')`,
        [participantId, a.tenantId, `${participantId}@example.test`],
      );
      await getTenantPool(a).query(
        "INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,'Payment Participant')",
        [a.tenantId, participantId],
      );
      const tenant = {
        tenantId: a.tenantId,
        databaseName: a.databaseName,
        features: {
          registration: true,
          courses: true,
          events: true,
          waitlist: false,
          payments: true,
        },
      } as TenantContext;
      const ownerScope = {
        tenant,
        actor: {
          ...s.actor,
          permissions: new Set([
            "settings.manage",
            "payment.manage",
            "refund.manage",
          ]),
        },
        requestId: randomUUID(),
      };
      const participantScope = {
        tenant,
        actor: {
          id: participantId,
          tenantId: a.tenantId,
          email: `${participantId}@example.test`,
          name: "Payment Participant",
          authenticationLevel: "PASSWORD",
          permissions: new Set<string>(),
        },
        requestId: randomUUID(),
      };
      await saveProviderConfiguration(
        tenant,
        "TEST",
        {},
        ownerScope.actor,
        ownerScope.requestId,
      );
      await setProviderEnabled(
        tenant,
        "TEST",
        true,
        ownerScope.actor,
        ownerScope.requestId,
      );
      const enrolled = await enrollParticipant(participantScope, paidRunId, {});
      if (!enrolled.id) throw new Error("Paid enrollment was not created.");
      const callbackUrl =
        "http://pay.localhost:3000/api/tenant/payments/callback/TEST";
      const first = await startPaymentAttempt({
        ...participantScope,
        enrollmentId: enrolled.id,
        providerKey: "TEST",
        callbackUrl,
      });
      const failureProof = createHmac(
        "sha256",
        process.env.BETTER_AUTH_SECRET ?? "",
      )
        .update(`${first.paymentAttemptId}:FAILED`)
        .digest("hex");
      const failed = await verifyPaymentAttempt({
        tenant,
        attemptId: first.paymentAttemptId,
        expectedProviderKey: "TEST",
        callback: { outcome: "FAILED", proof: failureProof },
        requestId: randomUUID(),
      });
      expect(failed.state).toBe("FAILED");
      const second = await startPaymentAttempt({
        ...participantScope,
        enrollmentId: enrolled.id,
        providerKey: "TEST",
        callbackUrl,
      });
      if (!second.redirectUrl)
        throw new Error("TEST redirect was not created.");
      const callback = Object.fromEntries(
        new URL(second.redirectUrl).searchParams,
      );
      const verified = await verifyPaymentAttempt({
        tenant,
        attemptId: second.paymentAttemptId,
        expectedProviderKey: "TEST",
        callback,
        requestId: randomUUID(),
      });
      expect(verified.state).toBe("SUCCEEDED");
      expect(
        (
          await verifyPaymentAttempt({
            tenant,
            attemptId: second.paymentAttemptId,
            expectedProviderKey: "TEST",
            callback,
            requestId: randomUUID(),
          })
        ).state,
      ).toBe("SUCCEEDED");
      await expect(
        verifyPaymentAttempt({
          tenant: {
            ...tenant,
            tenantId: b.tenantId,
            databaseName: b.databaseName,
          },
          attemptId: second.paymentAttemptId,
          expectedProviderKey: "TEST",
          callback,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow("not found");
      const rows = await getTenantPool(a).query<{
        status: string;
        attempts: number;
        invoices: number;
      }>(
        `SELECT e.status,
           (SELECT count(*)::int FROM payment_attempts WHERE tenant_id=e.tenant_id AND payment_id=$3) AS attempts,
           (SELECT count(*)::int FROM invoices WHERE tenant_id=e.tenant_id AND payment_id=$3) AS invoices
         FROM enrollments e WHERE e.tenant_id=$1 AND e.id=$2`,
        [a.tenantId, enrolled.id, second.paymentId],
      );
      expect(rows.rows[0]).toEqual({
        status: "CONFIRMED",
        attempts: 2,
        invoices: 1,
      });
      await refundPayment(ownerScope, {
        paymentId: second.paymentId,
        amount: 5000n,
        method: "PROVIDER",
        reason: "Integration refund",
      });
      const refunded = await getTenantPool(a).query<{
        status: string;
        state: string;
      }>(
        `SELECT e.status,p.state FROM enrollments e JOIN payments p ON p.tenant_id=e.tenant_id AND p.enrollment_id=e.id
         WHERE e.tenant_id=$1 AND e.id=$2`,
        [a.tenantId, enrolled.id],
      );
      expect(refunded.rows[0]).toEqual({
        status: "REFUNDED",
        state: "REFUNDED",
      });
    } finally {
      await control.query(
        "DELETE FROM tenant_payment_provider_allowlist WHERE tenant_id=$1",
        [a.tenantId],
      );
      await control.query("DELETE FROM tenants WHERE id=$1", [a.tenantId]);
    }
  });

  it("expires capacity and coupons safely against a late callback, then reconciles a new payment once", async () => {
    const s = scope(a);
    const lifecycleProgram = await createProgram(s, {
      ...programInput,
      slug: `lifecycle-${randomUUID().slice(0, 8)}`,
    });
    await transitionProgram(s, String(lifecycleProgram.id), "ACTIVE");
    const startsAt = new Date(Date.now() + 180 * day);
    const endsAt = new Date(startsAt.getTime() + day);
    const run = await createRun(s, {
      ...runInput(String(lifecycleProgram.id), randomUUID(), a.instructorA),
      startsAt,
      endsAt,
      capacity: 1,
      minimumCapacity: null,
      waitlistEnabled: false,
      deliveryMode: "ONLINE",
      venueId: null,
      priceAmount: 8000,
      priceCurrency: "IRR",
    });
    const paidRunId = String(run.id);
    await createSession(s, {
      runId: paidRunId,
      title: "Expiry test session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      timezone: "Asia/Tehran",
      deliveryMode: "ONLINE",
      venueId: null,
      roomId: null,
      instructorIds: [a.instructorA],
      notes: "Synthetic",
    });
    await transitionRun(s, paidRunId, "PUBLISHED");
    const tenant = {
      tenantId: a.tenantId,
      databaseName: a.databaseName,
      features: {
        registration: true,
        courses: true,
        events: true,
        payments: true,
      },
    } as TenantContext;
    const coupon = await createCoupon(
      {
        tenant,
        actor: { ...s.actor, permissions: new Set(["payment.manage"]) },
        requestId: randomUUID(),
      },
      {
        code: `EXPIRE${randomUUID().slice(0, 8).toUpperCase()}`,
        discountType: "FIXED",
        discountValue: 1000n,
        currency: "IRR",
        maxUses: 1,
        startsAt: null,
        endsAt: null,
      },
    );
    const participant = async () => {
      const id = randomUUID();
      await getTenantPool(a).query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status)
         VALUES ($1,$2,'Lifecycle Participant',$3,true,'ACTIVE')`,
        [id, a.tenantId, `${id}@example.test`],
      );
      await getTenantPool(a).query(
        "INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,'Lifecycle Participant')",
        [a.tenantId, id],
      );
      return {
        tenant,
        actor: {
          id,
          tenantId: a.tenantId,
          email: `${id}@example.test`,
          name: "Lifecycle Participant",
          authenticationLevel: "PASSWORD" as const,
          permissions: new Set<string>(),
        },
        requestId: randomUUID(),
      };
    };
    const firstActor = await participant();
    const first = await enrollParticipant(firstActor, paidRunId, {});
    if (!first.id) throw new Error("Enrollment fixture is incomplete.");
    await applyCoupon(firstActor, first.id, coupon.code);
    const firstPayment = await getTenantPool(a).query<{ id: string }>(
      "SELECT id FROM payments WHERE tenant_id=$1 AND enrollment_id=$2",
      [a.tenantId, first.id],
    );
    const firstPaymentId = firstPayment.rows[0]?.id;
    if (!firstPaymentId) throw new Error("Payment fixture is incomplete.");
    const firstAttemptId = randomUUID();
    await getTenantPool(a).query(
      `INSERT INTO payment_attempts
         (tenant_id,id,payment_id,attempt_number,provider_key,encrypted_config,state,provider_authority)
       VALUES ($1,$2,$3,1,'TEST',$4,'REQUIRES_REDIRECT',$5)`,
      [
        a.tenantId,
        firstAttemptId,
        firstPaymentId,
        encryptProviderConfig(a.tenantId, "TEST", {}),
        firstAttemptId,
      ],
    );
    await getTenantPool(a).query(
      "UPDATE enrollments SET payment_expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",
      [a.tenantId, first.id],
    );
    const proof = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
      .update(`${firstAttemptId}:SUCCEEDED`)
      .digest("hex");
    const race = await Promise.allSettled([
      expirePaymentReservations(tenant, randomUUID()),
      verifyPaymentAttempt({
        tenant,
        attemptId: firstAttemptId,
        expectedProviderKey: "TEST",
        callback: { outcome: "SUCCEEDED", proof },
        requestId: randomUUID(),
      }),
    ]);
    expect(race.every((result) => result.status === "fulfilled")).toBe(true);
    expect(
      (await expirePaymentReservations(tenant, randomUUID())).expired,
    ).toBe(0);
    const expired = await getTenantPool(a).query<{
      enrollment_status: string;
      payment_state: string;
      coupon_status: string;
      used_count: number;
      invoice_count: number;
    }>(
      `SELECT e.status AS enrollment_status,p.state AS payment_state,
         cr.status AS coupon_status,c.used_count,
         (SELECT count(*)::int FROM invoices i WHERE i.tenant_id=p.tenant_id AND i.payment_id=p.id) AS invoice_count
       FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
       JOIN coupon_reservations cr ON cr.tenant_id=p.tenant_id AND cr.payment_id=p.id
       JOIN coupons c ON c.tenant_id=cr.tenant_id AND c.id=cr.coupon_id
       WHERE p.tenant_id=$1 AND p.id=$2`,
      [a.tenantId, firstPaymentId],
    );
    expect(expired.rows[0]).toEqual({
      enrollment_status: "EXPIRED",
      payment_state: "SUCCEEDED",
      coupon_status: "RELEASED",
      used_count: 0,
      invoice_count: 1,
    });
    const secondActor = await participant();
    const second = await enrollParticipant(secondActor, paidRunId, {});
    expect(second.status).toBe("AWAITING_PAYMENT");
    if (!second.id) throw new Error("Second enrollment is incomplete.");
    await applyCoupon(secondActor, second.id, coupon.code);
    const secondPayment = await getTenantPool(a).query<{ id: string }>(
      "SELECT id FROM payments WHERE tenant_id=$1 AND enrollment_id=$2",
      [a.tenantId, second.id],
    );
    const secondPaymentId = secondPayment.rows[0]?.id;
    if (!secondPaymentId) throw new Error("Second payment is incomplete.");
    let providerUnavailable = true;
    const fake = {
      key: "RECONCILE_FAKE",
      displayName: "Reconcile fake",
      configSchema: z.strictObject({}),
      capabilities: {
        supportsRedirectPayment: false,
        supportsWebhook: false,
        supportsServerVerification: false,
        supportsRefund: false,
        supportsPartialRefund: false,
        supportsPaymentStatusQuery: true,
        supportsSettlementQuery: false,
        supportsSandbox: false,
      },
      async createPayment() {
        return { state: "PENDING" as const };
      },
      async queryPayment(input: { amount: bigint; currency: string }) {
        if (providerUnavailable) throw new Error("Temporary provider outage.");
        return {
          state: "SUCCEEDED" as const,
          verifiedAmount: input.amount,
          verifiedCurrency: input.currency,
          providerTransactionId: "reconciled-transaction",
        };
      },
    };
    const unregister = registerPaymentProviderForTests(fake);
    try {
      await getTenantPool(a).query(
        `INSERT INTO payment_attempts
           (tenant_id,payment_id,attempt_number,provider_key,encrypted_config,state)
         VALUES ($1,$2,1,'RECONCILE_FAKE',$3,'PENDING')`,
        [
          a.tenantId,
          secondPaymentId,
          encryptProviderConfig(a.tenantId, "RECONCILE_FAKE", {}),
        ],
      );
      expect(
        (
          await reconcileUnresolvedPayments(
            tenant,
            randomUUID(),
            50,
            "RECONCILE_FAKE",
          )
        ).failed,
      ).toBe(1);
      expect(
        (
          await reconcileUnresolvedPayments(
            tenant,
            randomUUID(),
            50,
            "RECONCILE_FAKE",
          )
        ).checked,
      ).toBe(0);
      const deferred = await getTenantPool(a).query<{
        reconcile_failures: number;
        later: boolean;
      }>(
        `SELECT reconcile_failures,next_reconcile_at > now() AS later FROM payment_attempts
         WHERE tenant_id=$1 AND payment_id=$2`,
        [a.tenantId, secondPaymentId],
      );
      expect(deferred.rows[0]).toMatchObject({
        reconcile_failures: 1,
        later: true,
      });
      providerUnavailable = false;
      await getTenantPool(a).query(
        "UPDATE payment_attempts SET next_reconcile_at=now()-interval '1 second' WHERE tenant_id=$1 AND payment_id=$2",
        [a.tenantId, secondPaymentId],
      );
      expect(
        (
          await reconcileUnresolvedPayments(
            tenant,
            randomUUID(),
            50,
            "RECONCILE_FAKE",
          )
        ).updated,
      ).toBe(1);
      expect(
        (
          await reconcileUnresolvedPayments(
            tenant,
            randomUUID(),
            50,
            "RECONCILE_FAKE",
          )
        ).checked,
      ).toBe(0);
      const settled = await getTenantPool(a).query<{
        enrollment_status: string;
        invoice_count: number;
        used_count: number;
      }>(
        `SELECT e.status AS enrollment_status,c.used_count,
           (SELECT count(*)::int FROM invoices i WHERE i.tenant_id=p.tenant_id AND i.payment_id=p.id) AS invoice_count
         FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
         JOIN coupons c ON c.tenant_id=p.tenant_id AND c.id=p.coupon_id
         WHERE p.tenant_id=$1 AND p.id=$2`,
        [a.tenantId, secondPaymentId],
      );
      expect(settled.rows[0]).toEqual({
        enrollment_status: "CONFIRMED",
        invoice_count: 1,
        used_count: 1,
      });
      const invoice = await getTenantPool(a).query<{ id: string }>(
        "SELECT id FROM invoices WHERE tenant_id=$1 AND payment_id=$2",
        [a.tenantId, secondPaymentId],
      );
      const invoiceId = invoice.rows[0]?.id;
      if (!invoiceId) throw new Error("Reconciled invoice is missing.");
      await expect(
        getInvoiceForDownload({ tenant, actor: firstActor.actor }, invoiceId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        getOwnPayment({ tenant, actor: firstActor.actor }, secondPaymentId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      unregister();
    }
  }, 120_000);

  it("enforces attendance, QR replay, certificate issuance, storage, revocation and tenant boundaries", async () => {
    const pool = getTenantPool(a);
    const participantOne = randomUUID();
    const participantTwo = randomUUID();
    const participantIds = [participantOne, participantTwo];
    for (const id of participantIds) {
      await pool.query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status) VALUES ($1,$2,'Phase 5 Participant',$3,true,'ACTIVE')`,
        [id, a.tenantId, `${id}@example.test`],
      );
      await pool.query(
        `INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,'Phase 5 Participant')`,
        [a.tenantId, id],
      );
      await pool.query(
        `INSERT INTO enrollments (tenant_id,run_id,participant_id,status,form_schema_snapshot) VALUES ($1,$2,$3,'CONFIRMED','{"version":1,"fields":[]}'::jsonb)`,
        [a.tenantId, runId, id],
      );
    }
    const tenant = {
      tenantId: a.tenantId,
      databaseName: a.databaseName,
      hostname: "phase5.localhost",
      branding: { brandName: "Phase 5" },
      features: { attendance: true, qr_attendance: true, certificates: true },
      limits: { max_storage_mb: 20 },
    } as TenantContext;
    const staffScope = {
      ...scope(a, a.ownerId, [
        "attendance.view",
        "attendance.manage",
        "attendance.export",
        "certificate.template.manage",
        "certificate.issue",
        "certificate.read",
        "certificate.revoke",
        "certificate.self.read",
        "session.manage",
      ]),
      tenant,
    };
    const participantScope = (id: string) => ({
      ...scope(a, id, [
        "attendance.checkin",
        "attendance.self.read",
        "certificate.self.read",
      ]),
      tenant,
    });
    await expect(
      markAttendanceBatch(participantScope(participantOne), sessionId, {
        records: [
          { participantId: participantOne, status: "PRESENT", notes: null },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getSessionAttendance(
        {
          ...staffScope,
          actor: { ...staffScope.actor, permissions: new Set<string>() },
        },
        sessionId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const instructorAttendanceScope = {
      ...scope(a, a.instructorB, ["attendance.view", "attendance.manage"]),
      tenant,
    };
    await expect(
      getSessionAttendance(instructorAttendanceScope, sessionId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await markAttendanceBatch(staffScope, sessionId, {
      records: [
        { participantId: participantOne, status: "PRESENT", notes: null },
      ],
    });
    await expect(
      markAttendanceBatch(staffScope, sessionId, {
        records: [
          { participantId: participantOne, status: "ABSENT", notes: null },
          { participantId: a.instructorA, status: "PRESENT", notes: null },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await getSessionAttendance(staffScope, sessionId)).summary.present,
    ).toBe(1);
    await expect(
      getSessionAttendance(
        {
          ...staffScope,
          tenant: {
            ...tenant,
            features: { ...tenant.features, attendance: false },
          },
        },
        sessionId,
      ),
    ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    expect(
      (await listOwnAttendance(participantScope(participantOne))).summary.total,
    ).toBe(0);
    await expect(
      getSessionAttendance(
        {
          ...staffScope,
          tenant: {
            ...tenant,
            tenantId: b.tenantId,
            databaseName: b.databaseName,
          },
        },
        sessionId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const now = new Date();
    await pool.query(
      `UPDATE program_sessions SET starts_at=$3,ends_at=$4 WHERE tenant_id=$1 AND id=$2`,
      [
        a.tenantId,
        sessionId,
        new Date(now.getTime() - 60_000),
        new Date(now.getTime() + 60_000),
      ],
    );
    const qr = await issueAttendanceQr(staffScope, sessionId);
    expect(
      (await checkInWithQr(participantScope(participantTwo), qr.token)).status,
    ).toBe("PRESENT");
    await expect(
      checkInWithQr(participantScope(participantTwo), qr.token),
    ).rejects.toMatchObject({ code: "QR_REPLAYED" });
    const template = await saveTemplate(staffScope, {
      name: "Default",
      fields: {
        message: "{{participantName}} - {{programName}}",
        showOrganizationLogo: false,
        accentColor: "#174b57",
      },
    });
    await expect(
      issueCertificate(staffScope, {
        runId,
        participantId: participantOne,
        templateId: template.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await pool.query(
      `UPDATE program_runs SET state='COMPLETED' WHERE tenant_id=$1 AND id=$2`,
      [a.tenantId, runId],
    );
    const issued = await issueCertificate(staffScope, {
      runId,
      participantId: participantOne,
      templateId: template.id,
    });
    expect(
      (
        await issueCertificate(staffScope, {
          runId,
          participantId: participantOne,
          templateId: template.id,
        })
      ).alreadyIssued,
    ).toBe(true);
    expect(
      Buffer.from(
        (
          await getCertificatePdf(participantScope(participantOne), issued.id)
        ).subarray(0, 5),
      ).toString(),
    ).toBe("%PDF-");
    await expect(
      getCertificatePdf(participantScope(participantTwo), issued.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const certs = await listCertificates(staffScope);
    expect(certs).toHaveLength(1);
    expect(JSON.stringify(certs)).not.toContain("verification_code");
    const stored = await pool.query<{ verification_code: string }>(
      `SELECT verification_code FROM certificates WHERE tenant_id=$1 AND id=$2`,
      [a.tenantId, issued.id],
    );
    const code = stored.rows[0]?.verification_code;
    if (!code) throw new Error("Certificate verification code was not stored.");
    expect(await verifyCertificate(tenant, code)).not.toBeNull();
    expect(
      await verifyCertificate(
        { ...tenant, tenantId: b.tenantId, databaseName: b.databaseName },
        code,
      ),
    ).toBeNull();
    await revokeCertificate(staffScope, issued.id);
    expect(await verifyCertificate(tenant, code)).toBeNull();
    await expect(
      getCertificatePdf(participantScope(participantOne), issued.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 120_000);
});
