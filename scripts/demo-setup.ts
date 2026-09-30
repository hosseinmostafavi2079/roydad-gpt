import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { getServerConfig } from "../src/shared/config/env";
import {
  getControlPool,
  closeControlPool,
} from "../src/infrastructure/db/control/pool";
import {
  closeTenantPools,
  getTenantPool,
} from "../src/infrastructure/db/tenant/pool";
import { hashPlatformPassword } from "../src/infrastructure/auth/password";
import {
  createTenant,
  retryProvisioning,
} from "../src/modules/platform/tenants/service";
import { stopProvisioningBoss } from "../src/modules/platform/provisioning/queue";
import {
  createProgram,
  createRun,
  createSession,
  createVenue,
  createRoom,
  transitionProgram,
  transitionRun,
} from "../src/modules/program-core/repository";

if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.NODE_ENV === "production" || process.env.CI)
  throw new Error("Local demo setup is disabled in production and CI.");
const credentialPath = path.resolve(".demo-credentials.local");
const credentialSchema = z.strictObject({
  platform: z.strictObject({ email: z.email(), password: z.string().min(24) }),
  platformMfa: z
    .strictObject({
      secret: z.string().regex(/^[A-Z2-7]{32,64}$/),
      backupCodes: z.array(z.string()).length(10),
    })
    .optional(),
  owner: z.strictObject({ email: z.email(), password: z.string().min(24) }),
  instructor: z.strictObject({
    email: z.email(),
    password: z.string().min(24),
  }),
  participant: z.strictObject({
    email: z.email(),
    password: z.string().min(24),
  }),
});
const randomPassword = () => randomBytes(32).toString("base64url");
const existingCredentials = existsSync(credentialPath)
  ? credentialSchema.parse(JSON.parse(readFileSync(credentialPath, "utf8")))
  : credentialSchema.parse({
      platform: {
        email: "demo-platform-admin@example.test",
        password: randomPassword(),
      },
      owner: { email: "demo-owner@example.test", password: randomPassword() },
      instructor: {
        email: "demo-instructor@example.test",
        password: randomPassword(),
      },
      participant: {
        email: "demo-participant@example.test",
        password: randomPassword(),
      },
    });
const { platformMfa: _previousMfa, ...credentials } = existingCredentials;
const config = getServerConfig();
for (const key of [
  "CONTROL_DATABASE_URL",
  "CONTROL_MIGRATION_DATABASE_URL",
  "CONTROL_QUEUE_DATABASE_URL",
  "TENANT_PROVISIONING_DATABASE_URL",
  "TENANT_RUNTIME_DATABASE_URL",
  "TENANT_MIGRATION_DATABASE_URL",
] as const) {
  if (
    !["127.0.0.1", "localhost", "::1"].includes(new URL(config[key]).hostname)
  )
    throw new Error("Demo setup requires local PostgreSQL only.");
}
if (
  config.PLATFORM_BASE_DOMAIN !== "localhost" ||
  new URL(config.BETTER_AUTH_URL).hostname !== "localhost"
)
  throw new Error("Demo setup requires localhost hostnames.");
writeFileSync(credentialPath, `${JSON.stringify(credentials, null, 2)}\n`, {
  mode: 0o600,
});
const developmentEnvPath = ".env.development.local";
if (existsSync(developmentEnvPath)) {
  const developmentEnv = readFileSync(developmentEnvPath, "utf8");
  const securedEnv = developmentEnv.replace(
    /^PLATFORM_REQUIRE_MFA=true\s*$/m,
    "PLATFORM_REQUIRE_MFA=false",
  );
  if (securedEnv !== developmentEnv)
    writeFileSync(developmentEnvPath, securedEnv, { mode: 0o600 });
}

async function ensurePlatformAdmin() {
  const pool = getControlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('eventos-demo-admin',0))",
    );
    const hash = await hashPlatformPassword(credentials.platform.password);
    let existing = await client.query<{ id: string; auth_user_id: string }>(
      "SELECT id,auth_user_id FROM platform_admins WHERE email=$1 FOR UPDATE",
      [credentials.platform.email],
    );
    if (!existing.rows[0]) {
      const userId = randomUUID(),
        adminId = randomUUID();
      await client.query(
        `INSERT INTO platform_auth_users (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,now(),now())`,
        [userId, "Local Demo Administrator", credentials.platform.email],
      );
      await client.query(
        `INSERT INTO platform_admins (id,auth_user_id,email,display_name) VALUES ($1,$2,$3,$4)`,
        [
          adminId,
          userId,
          credentials.platform.email,
          "Local Demo Administrator",
        ],
      );
      existing = { ...existing, rows: [{ id: adminId, auth_user_id: userId }] };
    }
    const admin = existing.rows[0];
    if (!admin) throw new Error("Demo platform administrator was not created.");
    await client.query(
      `DELETE FROM platform_auth_accounts WHERE "userId"=$1 AND "providerId"='credential'`,
      [admin.auth_user_id],
    );
    await client.query(
      `INSERT INTO platform_auth_accounts (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
       VALUES ($1,$2,'credential',$2,$3,now(),now())`,
      [randomUUID(), admin.auth_user_id, hash],
    );
    await client.query(`DELETE FROM platform_auth_sessions WHERE "userId"=$1`, [
      admin.auth_user_id,
    ]);
    await client.query(
      `DELETE FROM platform_admin_two_factors WHERE "userId"=$1`,
      [admin.auth_user_id],
    );
    await client.query(
      `UPDATE platform_auth_users SET "twoFactorEnabled"=false,"updatedAt"=now() WHERE id=$1`,
      [admin.auth_user_id],
    );
    await client.query("COMMIT");
    return admin.id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function startWorker(outbox: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      "scripts/provisioning-worker.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        MAIL_TRANSPORT: "test",
        EVENTOS_TEST_MAIL_OUTBOX: outbox,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Demo provisioning worker did not become ready.")),
      20_000,
    );
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Demo provisioning worker could not start."));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Demo provisioning worker exited before readiness."));
    });
    child.on("message", (message) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "eventos.provisioning.ready"
      ) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return child;
}
async function stopWorker(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Demo provisioning worker did not stop.")),
      15_000,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
async function waitForTenant(tenantId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await getControlPool().query<{
      status: string;
      database_name: string;
    }>(
      `SELECT tenant.status,registry.database_name FROM tenants tenant JOIN tenant_database_registry registry ON registry.tenant_id=tenant.id WHERE tenant.id=$1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (row?.status === "ACTIVE") return row.database_name;
    if (row?.status === "FAILED")
      throw new Error(
        "Demo tenant provisioning failed; inspect the provisioning job status.",
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Demo tenant provisioning did not finish within 90 seconds.");
}

async function ensureDemoTenant(adminId: string) {
  const actor = {
    adminId,
    userId: "demo-setup",
    email: credentials.platform.email,
    name: "Local Demo Administrator",
    twoFactorEnabled: false,
  };
  const existing = await getControlPool().query<{
    id: string;
    status: string;
    database_name: string;
    created_by: string;
  }>(
    `SELECT tenant.id,tenant.status,registry.database_name,tenant.created_by FROM tenants tenant
     JOIN tenant_database_registry registry ON registry.tenant_id=tenant.id WHERE tenant.slug='demo'`,
  );
  let tenantId = existing.rows[0]?.id;
  if (existing.rows[0] && existing.rows[0].created_by !== adminId)
    throw new Error("The demo slug is already owned by another administrator.");
  if (!tenantId) {
    const created = await createTenant(
      {
        slug: "demo",
        legalName: "آکادمی رویداد آزمایشی",
        displayName: "آکادمی رویداد آزمایشی",
        planCode: "foundation",
        ownerName: "مدیر سازمان آزمایشی",
        ownerEmail: credentials.owner.email,
      },
      actor,
      randomUUID(),
    );
    tenantId = created.tenant.id;
  } else if (existing.rows[0]?.status === "FAILED")
    await retryProvisioning(tenantId, actor, randomUUID());
  const databaseName = await waitForTenant(tenantId);
  const control = getControlPool();
  await control.query(
    `INSERT INTO tenant_features (tenant_id,feature_key,enabled,updated_by)
     SELECT $1,key,true,$2 FROM unnest(ARRAY['courses','events','crm']::text[]) AS key
     ON CONFLICT (tenant_id,feature_key) DO UPDATE SET enabled=true,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [tenantId, adminId],
  );
  await control.query(
    "UPDATE tenant_branding SET brand_name=$2,updated_by=$3 WHERE tenant_id=$1",
    [tenantId, "آکادمی رویداد آزمایشی", adminId],
  );
  return { tenantId, databaseName };
}

async function ensureTenantUser(
  tenantId: string,
  databaseName: string,
  identity: "platform" | "owner" | "instructor" | "participant",
  roleCode: string,
) {
  const profile = credentials[identity],
    pool = getTenantPool({ tenantId, databaseName });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE "tenantId"=$1 AND email=$2 FOR UPDATE`,
      [tenantId, profile.email],
    );
    const id = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0])
      await client.query(
        `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status) VALUES ($1,$2,$3,$4,true,'ACTIVE')`,
        [
          id,
          tenantId,
          identity === "owner"
            ? "مدیر سازمان آزمایشی"
            : identity === "instructor"
              ? "مدرس آزمایشی"
              : "شرکت‌کننده آزمایشی",
          profile.email,
        ],
      );
    else
      await client.query(
        `UPDATE tenant_users SET status='ACTIVE',"emailVerified"=true,"updatedAt"=now() WHERE "tenantId"=$1 AND id=$2`,
        [tenantId, id],
      );
    await client.query(
      `INSERT INTO tenant_auth_accounts (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
      VALUES ($1,$2,'credential',$2,$3,now(),now()) ON CONFLICT ("providerId","accountId") DO UPDATE SET password=EXCLUDED.password,"updatedAt"=now()`,
      [randomUUID(), id, await hashPlatformPassword(profile.password)],
    );
    await client.query(
      `INSERT INTO tenant_user_roles (tenant_id,user_id,role_id)
      SELECT $1,$2,id FROM tenant_roles WHERE tenant_id=$1 AND code=$3 ON CONFLICT DO NOTHING`,
      [tenantId, id, roleCode],
    );
    if (identity === "instructor")
      await client.query(
        `INSERT INTO tenant_instructor_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tenantId, id, "مدرس آزمایشی"],
      );
    if (identity === "participant")
      await client.query(
        `INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tenantId, id, "شرکت‌کننده آزمایشی"],
      );
    await client.query(
      `UPDATE tenant_invitations SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [tenantId, id],
    );
    await client.query(
      `DELETE FROM tenant_auth_sessions WHERE "tenantId"=$1 AND "userId"=$2`,
      [tenantId, id],
    );
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function seedContent(
  tenantId: string,
  databaseName: string,
  ownerId: string,
  instructorId: string,
  participantId: string,
) {
  const tenant = { tenantId, databaseName };
  const actor = {
    id: ownerId,
    email: credentials.owner.email,
    name: "مدیر سازمان آزمایشی",
    tenantId,
    authenticationLevel: "PASSWORD",
    permissions: new Set([
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
    ]),
  };
  const scope = { tenant, actor, requestId: randomUUID() };
  const pool = getTenantPool(tenant);
  await pool.query(
    `UPDATE tenant_website_profiles SET display_name=$2,short_description=$3,about=$4,
      phone=$5,email=$6,address=$7,contact_hours=$8,footer_description=$9,updated_at=now()
     WHERE tenant_id=$1`,
    [
      tenantId,
      "آکادمی رویداد آزمایشی",
      "دوره‌ها و رویدادهای آموزشی برای یادگیری در کنار هم",
      "آکادمی رویداد آزمایشی یک مجموعه ساختگی برای بررسی امکانات عمومی، ثبت‌نام و مدیریت دوره‌ها است.",
      "021-00000000",
      "demo-contact@example.test",
      "اصفهان، مرکز آموزشی رویداد",
      "شنبه تا چهارشنبه، ۹ تا ۱۷",
      "با هم یاد می‌گیریم.",
    ],
  );
  const venueResult = await pool.query<{ id: string }>(
    "SELECT id FROM venues WHERE tenant_id=$1 AND name=$2",
    [tenantId, "مرکز آموزشی رویداد"],
  );
  const venueId =
    venueResult.rows[0]?.id ??
    String(
      (
        await createVenue(scope, {
          name: "مرکز آموزشی رویداد",
          address: "خیابان آموزشی، پلاک ۱",
          city: "اصفهان",
          description: "مکان آزمایشی",
          active: true,
        })
      ).id,
    );
  const roomResult = await pool.query<{ id: string }>(
    "SELECT id FROM rooms WHERE tenant_id=$1 AND venue_id=$2 AND name=$3",
    [tenantId, venueId, "کلاس شماره ۱"],
  );
  const roomId =
    roomResult.rows[0]?.id ??
    String(
      (
        await createRoom(scope, {
          venueId,
          name: "کلاس شماره ۱",
          capacity: 30,
          description: "کلاس آزمایشی",
          active: true,
        })
      ).id,
    );
  const samples = [
    {
      slug: "creative-writing",
      title: "کارگاه نویسندگی خلاق",
      type: "WORKSHOP" as const,
      run: "دوره پاییز ۱۴۰۵",
    },
    {
      slug: "contract-law-webinar",
      title: "وبینار آشنایی با حقوق قراردادها",
      type: "WEBINAR" as const,
      run: "وبینار آزمایشی حقوق قراردادها",
    },
  ];
  for (const [index, sample] of samples.entries()) {
    const existing = await pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM programs WHERE tenant_id=$1 AND slug=$2",
      [tenantId, sample.slug],
    );
    const programId =
      existing.rows[0]?.id ??
      String(
        (
          await createProgram(scope, {
            type: sample.type,
            title: sample.title,
            slug: sample.slug,
            shortDescription: "نمونه آموزشی برای آشنایی با سامانه",
            description: "محتوای آزمایشی و کاملاً ساختگی",
            category: index === 0 ? "هنر و ادبیات" : "حقوق",
            level: "مقدماتی",
            objectives: "آشنایی با مبانی",
            prerequisites: "ندارد",
            intendedAudience: "علاقه‌مندان",
            defaultDurationMinutes: 120,
          })
        ).id,
      );
    if (existing.rows[0]?.status === "DRAFT")
      await transitionProgram(scope, programId, "ACTIVE");
    if (!existing.rows[0]) await transitionProgram(scope, programId, "ACTIVE");
    const runExisting = await pool.query<{ id: string; state: string }>(
      "SELECT id,state FROM program_runs WHERE tenant_id=$1 AND program_id=$2 AND title=$3",
      [tenantId, programId, sample.run],
    );
    const now = Date.now(),
      day = 86_400_000;
    const start = new Date(now + (10 + index * 10) * day),
      end = new Date(now + (70 + index * 10) * day);
    const runId =
      runExisting.rows[0]?.id ??
      String(
        (
          await createRun(scope, {
            programId,
            title: sample.run,
            startsAt: start,
            endsAt: end,
            registrationStartsAt: null,
            registrationEndsAt: null,
            deliveryMode: index === 0 ? "IN_PERSON" : "ONLINE",
            capacity: index === 0 ? 24 : 1,
            minimumCapacity: null,
            waitlistEnabled: index === 1,
            venueId: index === 0 ? venueId : null,
            instructorIds: [instructorId],
            notes: "داده آزمایشی",
          })
        ).id,
      );
    const count = index === 0 ? 3 : 1;
    for (let n = 0; n < count; n++) {
      const title =
        index === 0
          ? `جلسه ${n + 1} نویسندگی خلاق`
          : "جلسه وبینار حقوق قراردادها";
      const found = await pool.query(
        "SELECT id FROM program_sessions WHERE tenant_id=$1 AND run_id=$2 AND title=$3",
        [tenantId, runId, title],
      );
      if (found.rowCount) continue;
      const startsAt = new Date(now + (14 + index * 10 + n * 7) * day),
        endsAt = new Date(startsAt.getTime() + 2 * 3600_000);
      await createSession(scope, {
        runId,
        title,
        startsAt,
        endsAt,
        timezone: "Asia/Tehran",
        deliveryMode: index === 0 ? "IN_PERSON" : "ONLINE",
        venueId: index === 0 ? venueId : null,
        roomId: index === 0 ? roomId : null,
        instructorIds: [instructorId],
        notes: "جلسه نمونه",
      });
    }
    if (runExisting.rows[0]?.state === "DRAFT" || !runExisting.rows[0])
      await transitionRun(scope, runId, "PUBLISHED");
    if (index === 1) {
      await pool.query(
        "UPDATE program_runs SET capacity=1,waitlist_enabled=true WHERE tenant_id=$1 AND id=$2",
        [tenantId, runId],
      );
      await pool.query(
        `INSERT INTO enrollments (tenant_id,run_id,participant_id,status,answers,form_schema_snapshot)
         VALUES ($1,$2,$3,'CONFIRMED','{}'::jsonb,'{"version":1,"fields":[]}'::jsonb)
         ON CONFLICT (tenant_id,run_id,participant_id) DO NOTHING`,
        [tenantId, runId, participantId],
      );
    }
  }
}

let worker: ChildProcess | undefined;
const outbox = path.join(
  os.tmpdir(),
  `eventos-demo-mail-${randomUUID()}.jsonl`,
);
try {
  const adminId = await ensurePlatformAdmin();
  process.env.MAIL_TRANSPORT = "test";
  process.env.EVENTOS_TEST_MAIL_OUTBOX = outbox;
  worker = await startWorker(outbox);
  const { tenantId, databaseName } = await ensureDemoTenant(adminId);
  const ownerId = await ensureTenantUser(
    tenantId,
    databaseName,
    "owner",
    "organization_owner",
  );
  const instructorId = await ensureTenantUser(
    tenantId,
    databaseName,
    "instructor",
    "instructor",
  );
  const participantId = await ensureTenantUser(
    tenantId,
    databaseName,
    "participant",
    "participant",
  );
  await seedContent(
    tenantId,
    databaseName,
    ownerId,
    instructorId,
    participantId,
  );
  console.log(
    `EventOS local demo is ready\n\nPlatform Admin:\nURL: http://localhost:3000/sign-in\nEmail: ${credentials.platform.email}\nPassword: ${credentials.platform.password}\n\nTenant Owner:\nURL: http://demo.localhost:3000/login\nEmail: ${credentials.owner.email}\nPassword: ${credentials.owner.password}\n\nInstructor:\nURL: http://demo.localhost:3000/login\nEmail: ${credentials.instructor.email}\nPassword: ${credentials.instructor.password}\n\nParticipant:\nURL: http://demo.localhost:3000/login\nEmail: ${credentials.participant.email}\nPassword: ${credentials.participant.password}\n\nCredentials are also in ignored .demo-credentials.local.`,
  );
} finally {
  if (worker) await stopWorker(worker).catch(() => undefined);
  await stopProvisioningBoss().catch(() => undefined);
  await closeTenantPools();
  await closeControlPool();
  if (existsSync(outbox))
    await import("node:fs/promises").then((fs) => fs.unlink(outbox));
}
