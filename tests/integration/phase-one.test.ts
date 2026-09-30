import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { once } from "node:events";
import { Client } from "pg";
import { resolveTxt } from "node:dns/promises";
import {
  acceptTenantInvitation,
  assignTenantUserRoles,
  createTenantRole,
  issueTenantUserInvitation,
  updateTenantRole,
  updateTenantUserStatus,
} from "@/modules/tenant-identity/repository";
import {
  requireTenantActor,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:dns/promises")>();
  return { ...original, resolveTxt: vi.fn() };
});
import {
  GET as getTenants,
  POST as createTenantRoute,
} from "@/app/api/platform/tenants/route";
import {
  hashPlatformPassword,
  verifyPlatformPassword,
} from "@/infrastructure/auth/password";
import { getAuth } from "@/infrastructure/auth/auth";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { applyTenantPrismaMigrations } from "@/infrastructure/db/tenant/prisma-migrations";
import {
  closeTenantPools,
  getTenantPool,
  tenantPoolCacheSize,
} from "@/infrastructure/db/tenant/pool";
import {
  getProvisioningBoss,
  provisioningQueueName,
  stopProvisioningBoss,
} from "@/modules/platform/provisioning/queue";
import {
  createTenant,
  createCustomDomain,
  changeTenantStatus,
  retryProvisioning,
  updateTenantLimits,
  updateTenantFeatures,
  verifyCustomDomain,
} from "@/modules/platform/tenants/service";
import {
  clearTenantResolutionCacheForTests,
  invalidateTenantResolutionCache,
  resolveTenantContext,
  tenantResolutionCacheSize,
} from "@/modules/tenants/resolver";
import {
  GET as tenantAuthGet,
  POST as tenantAuthPost,
} from "@/app/api/tenant-auth/[...all]/route";
import {
  GET as getTenantStaff,
  POST as postTenantStaff,
} from "@/app/api/tenant/identity/staff/route";
import { GET as getTenantRoles } from "@/app/api/tenant/roles/route";
import { POST as acceptTenantInvitationRoute } from "@/app/api/tenant/invitations/accept/route";
import { workerDiagnostics } from "../helpers/worker-diagnostics";
import { PUT as putWebsiteProfile } from "@/app/api/tenant/website/route";
import { getWebsiteProfile } from "@/modules/public-site/profile";
import { saveMedia, removeMedia } from "@/modules/media/repository";
import { GET as getPublicMedia } from "@/app/api/media/[id]/route";

if (existsSync(".env")) process.loadEnvFile(".env");

const migrations = path.join(
  process.cwd(),
  "src",
  "infrastructure",
  "db",
  "control",
  "migrations",
);
const cleanupTenantIds: string[] = [];
const workerProcesses: ChildProcess[] = [];
const testMailOutbox = path.join(
  os.tmpdir(),
  `eventos-integration-mail-${process.pid}.jsonl`,
);
process.env.EVENTOS_TEST_MAIL_OUTBOX = testMailOutbox;
const workerOutput = new WeakMap<ChildProcess, string>();
let adminId = "";
let adminEmail = "";

function startWorker(failurePhase?: string): Promise<ChildProcess> {
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
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
        ...(failurePhase ? { EVENTOS_TEST_FAIL_PHASE: failurePhase } : {}),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    },
  );
  child.stdin?.end();
  workerProcesses.push(child);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const diagnostics = () => workerDiagnostics(stdout, stderr);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(child);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(
        new Error(`Provisioning worker readiness timed out; ${diagnostics()}`),
      );
    }, 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      workerOutput.set(child, stdout + stderr);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      workerOutput.set(child, stdout + stderr);
    });
    child.on("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "eventos.provisioning.ready"
      ) {
        finish();
      }
    });
    child.once("error", (error) =>
      finish(
        new Error(
          `Provisioning worker spawn failed: ${error.message}; ${diagnostics()}`,
        ),
      ),
    );
    child.once("close", (code, signal) =>
      finish(
        new Error(
          `Provisioning worker exited before readiness (code ${code}, signal ${signal}); ${diagnostics()}`,
        ),
      ),
    );
  });
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Provisioning worker did not stop cleanly.")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runTenantMigrationCommand(): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      "scripts/migrate-tenant-databases.ts",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  const [code, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (code !== 0) {
    throw new Error(
      `Tenant database upgrade command failed (${signal ?? code}): ${output.slice(-1500)}`,
    );
  }
}

async function waitForState(
  tenantId: string,
  expected: string,
): Promise<{ state: string; database_name: string }> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = await getControlPool().query<{
      state: string;
      database_name: string;
    }>(
      `SELECT job.state, registry.database_name
       FROM provisioning_jobs AS job JOIN tenant_database_registry AS registry ON registry.tenant_id = job.tenant_id
       WHERE job.tenant_id = $1 ORDER BY job.created_at DESC LIMIT 1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (row?.state === expected) return row;
    if (row?.state.startsWith("FAILED_") && !expected.startsWith("FAILED_")) {
      const logs = workerProcesses
        .map((child) => workerOutput.get(child) ?? "")
        .join("\n")
        .slice(-2500);
      throw new Error(
        `Provisioning failed before reaching ${expected}: ${row.state}; logs: ${logs}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Tenant ${tenantId} did not reach ${expected} within 45 seconds.`,
  );
}

async function removeTenantFixtures(): Promise<void> {
  await closeTenantPools();
  const provisioner = new Client({
    connectionString: process.env.TENANT_PROVISIONING_DATABASE_URL,
  });
  await provisioner.connect();
  try {
    for (const tenantId of cleanupTenantIds) {
      const result = await getControlPool().query<{ database_name: string }>(
        "SELECT database_name FROM tenant_database_registry WHERE tenant_id = $1",
        [tenantId],
      );
      const name = result.rows[0]?.database_name;
      if (name && /^eventos_t_[0-9a-f]{32}$/.test(name)) {
        await provisioner.query(
          `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
        );
      }
      const client = await getControlPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM provisioning_job_transitions WHERE job_id IN (SELECT id FROM provisioning_jobs WHERE tenant_id = $1)",
          [tenantId],
        );
        await client.query(
          "DELETE FROM provisioning_jobs WHERE tenant_id = $1",
          [tenantId],
        );
        await client.query(
          "DELETE FROM tenant_database_registry WHERE tenant_id = $1",
          [tenantId],
        );
        await client.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await provisioner.end();
  }
}

describe("Phase 1 real PostgreSQL gates", () => {
  beforeAll(async () => {
    if (
      !process.env.CONTROL_DATABASE_URL ||
      !process.env.TENANT_PROVISIONING_DATABASE_URL
    ) {
      throw new Error(
        "PostgreSQL integration tests require .env or CI database URLs.",
      );
    }
    const control = new URL(process.env.CONTROL_DATABASE_URL);
    if (!["127.0.0.1", "localhost", "::1"].includes(control.hostname)) {
      throw new Error(
        "Integration tests require a local disposable PostgreSQL instance.",
      );
    }
    const migration = new Client({
      connectionString: process.env.CONTROL_MIGRATION_DATABASE_URL,
    });
    await migration.connect();
    await applySqlMigrations(
      migration,
      migrations,
      "eventos-control-plane-migrations",
    );
    await applySqlMigrations(
      migration,
      migrations,
      "eventos-control-plane-migrations",
    );
    await migration.end();
    const admin = await getControlPool().query<{ id: string; email: string }>(
      "SELECT id, email FROM platform_admins WHERE revoked_at IS NULL ORDER BY created_at ASC LIMIT 1",
    );
    if (!admin.rows[0])
      throw new Error("Run pnpm db:seed:dev before integration tests.");
    adminId = admin.rows[0].id;
    adminEmail = admin.rows[0].email;
  }, 60_000);

  afterAll(async () => {
    for (const child of workerProcesses)
      await stopWorker(child).catch(() => undefined);
    await stopProvisioningBoss().catch(() => undefined);
    clearTenantResolutionCacheForTests();
    await removeTenantFixtures();
    await getControlPool().end();
    await unlink(testMailOutbox).catch(() => undefined);
  }, 60_000);

  it("reuses migration checksums and verifies real Argon2id hashes", async () => {
    const result = await getControlPool().query<{ count: number }>(
      "SELECT count(*)::int AS count FROM eventos_schema_migrations WHERE version IN ($1, $2, $3, $4, $5, $6, $7)",
      [
        "0000_platform_auth",
        "0001_control_plane",
        "0002_auth_rate_limit_id_default",
        "0003_auth_session_id_default",
        "0004_auth_two_factor_id_default",
        "0005_owner_bootstrap_ciphertext",
        "0006_auth_verification_id_default",
      ],
    );
    expect(result.rows[0]?.count).toBe(7);
    const verificationIdDefault = await getControlPool().query<{
      column_default: string | null;
    }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'platform_auth_verifications' AND column_name = 'id'`,
    );
    expect(verificationIdDefault.rows[0]?.column_default).toContain(
      "gen_random_uuid()",
    );
    const hash = await hashPlatformPassword(
      "local test password with enough length",
    );
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(
      verifyPlatformPassword(hash, "local test password with enough length"),
    ).resolves.toBe(true);
    await expect(
      verifyPlatformPassword(hash, "incorrect password"),
    ).resolves.toBe(false);
  }, 60_000);

  it("provisions, verifies, resolves, isolates, fails safely, retries, and invalidates tenant context", async () => {
    const actor = {
      adminId,
      userId: "integration-test",
      email: adminEmail,
      name: "Integration Test",
      twoFactorEnabled: true,
    } as const;
    const failedWorker = await startWorker("MIGRATING");
    const slugA = `test-${randomUUID().slice(0, 8)}`;
    const createRequestId = randomUUID();
    const first = await createTenant(
      {
        slug: slugA,
        legalName: "Integration Test A",
        displayName: "Test Organization A",
        planCode: "foundation",
        ownerName: "Initial Tenant Owner",
        ownerEmail: `owner-${slugA}@example.test`,
      },
      actor,
      createRequestId,
    );
    cleanupTenantIds.push(first.tenant.id);
    const failed = await waitForState(first.tenant.id, "FAILED_MIGRATION");
    expect(failed.state).toBe("FAILED_MIGRATION");
    const failureRecord = await getControlPool().query<{
      error_code: string;
      error_message: string;
    }>(
      "SELECT error_code, error_message FROM provisioning_jobs WHERE tenant_id = $1",
      [first.tenant.id],
    );
    expect(failureRecord.rows[0]?.error_code).toBe("FAILED_MIGRATION");
    expect(failureRecord.rows[0]?.error_message).not.toMatch(
      /password|postgresql:\/\//i,
    );
    await stopWorker(failedWorker);

    const worker = await startWorker();
    await retryProvisioning(first.tenant.id, actor, randomUUID());
    const readyA = await waitForState(first.tenant.id, "ACTIVE");
    const tenantHost = `${slugA}.localhost:3000`;
    const tenantOrigin = `http://${tenantHost}`;
    const resolvedFromForwardedRequest = await resolveTenantRequest(
      new Request("http://0.0.0.0:3000/api/tenant-auth/sign-in/email", {
        headers: {
          host: tenantHost,
          origin: tenantOrigin,
        },
      }),
    );
    expect(resolvedFromForwardedRequest.tenant.tenantId).toBe(first.tenant.id);
    expect(resolvedFromForwardedRequest.origin).toBe(tenantOrigin);
    await expect(
      resolveTenantRequest(
        new Request("http://0.0.0.0:3000/api/tenant-auth/sign-in/email", {
          headers: {
            host: tenantHost,
            origin: "https://attacker.example",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readyA.database_name).toMatch(/^eventos_t_[0-9a-f]{32}$/);
    const runtimeUrl = process.env.TENANT_RUNTIME_DATABASE_URL;
    if (!runtimeUrl)
      throw new Error("TENANT_RUNTIME_DATABASE_URL is required.");
    const tenantDb = new Client({
      connectionString: new URL(
        `/${readyA.database_name}`,
        runtimeUrl,
      ).toString(),
    });
    await tenantDb.connect();
    try {
      const roles = await tenantDb.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM tenant_role_templates",
      );
      const metadata = await tenantDb.query<{
        tenant_id: string;
        slug: string;
      }>("SELECT tenant_id, slug FROM tenant_metadata WHERE singleton = true");
      const ledger = await tenantDb.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM eventos_schema_migrations",
      );
      expect(roles.rows[0]?.count).toBe(11);
      expect(metadata.rows[0]).toEqual({
        tenant_id: first.tenant.id,
        slug: slugA,
      });
      expect(ledger.rows[0]?.count).toBe(1);
      const identity = await tenantDb.query<{
        role_count: number;
        permission_count: number;
        owner_grant_count: number;
        owner_status: string;
      }>(
        `SELECT (SELECT count(*)::int FROM tenant_roles WHERE tenant_id = $1) AS role_count,
                (SELECT count(*)::int FROM tenant_permissions WHERE tenant_id = $1) AS permission_count,
                (SELECT count(*)::int FROM tenant_role_permissions AS rp JOIN tenant_roles AS role
                   ON role.tenant_id = rp.tenant_id AND role.id = rp.role_id
                 WHERE role.tenant_id = $1 AND role.code = 'organization_owner') AS owner_grant_count,
                (SELECT account.status FROM tenant_users AS account WHERE account."tenantId" = $1 LIMIT 1) AS owner_status`,
        [first.tenant.id],
      );
      expect(identity.rows[0]).toMatchObject({
        role_count: 11,
        permission_count: 42,
        owner_grant_count: 42,
        owner_status: "INVITED",
      });
      const prismaHistory = await tenantDb.query<{ table_name: string | null }>(
        "SELECT to_regclass('public._prisma_migrations') AS table_name",
      );
      expect(prismaHistory.rows[0]?.table_name).toBe("_prisma_migrations");
      await expect(
        tenantDb.query("CREATE TABLE forbidden_runtime_ddl (id integer)"),
      ).rejects.toThrow();
    } finally {
      await tenantDb.end();
    }

    const outboxEntries = (await readFile(testMailOutbox, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { email: string; inviteUrl: string });
    const ownerEmail = `owner-${slugA}@example.test`;
    const invitation = outboxEntries.find(
      (entry) => entry.email === ownerEmail,
    );
    expect(invitation).toBeDefined();
    if (!invitation)
      throw new Error("Test owner invitation was not delivered.");
    expect(new URL(invitation.inviteUrl).port).toBe(
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").port,
    );
    const ownerContext = await resolveTenantContext(`${slugA}.localhost`);
    const invitationToken = new URL(invitation.inviteUrl).searchParams.get(
      "token",
    );
    if (!invitationToken) throw new Error("Test invitation URL was malformed.");
    const ownerTokenHash = await getTenantPool(ownerContext).query<{
      token_hash: string;
    }>(
      "SELECT token_hash FROM tenant_invitations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
      [first.tenant.id],
    );
    expect(ownerTokenHash.rows[0]?.token_hash).toBe(
      createHash("sha256").update(invitationToken).digest("hex"),
    );
    expect(ownerTokenHash.rows[0]?.token_hash).not.toBe(invitationToken);
    await applyTenantPrismaMigrations(readyA.database_name, first.tenant.id);
    const migrationCheck = new Client({
      connectionString: new URL(
        `/${readyA.database_name}`,
        process.env.TENANT_MIGRATION_DATABASE_URL,
      ).toString(),
    });
    await migrationCheck.connect();
    try {
      const prismaRows = await migrationCheck.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      );
      const appRows = await migrationCheck.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM tenant_schema_migrations WHERE version = '0007_organization_site_media'",
      );
      expect(prismaRows.rows[0]?.count).toBe(8);
      expect(appRows.rows[0]?.count).toBe(1);
    } finally {
      await migrationCheck.end();
    }
    await acceptTenantInvitation(
      ownerContext,
      invitationToken,
      "local owner password is secure",
      randomUUID(),
    );
    await expect(
      acceptTenantInvitation(
        ownerContext,
        invitationToken,
        "local owner password is secure",
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const ownerLogin = await tenantAuthPost(
      new Request(
        `http://${slugA}.localhost:3000/api/tenant-auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: `http://${slugA}.localhost:3000`,
            host: `${slugA}.localhost:3000`,
          },
          body: JSON.stringify({
            email: ownerEmail,
            password: "local owner password is secure",
          }),
        },
      ),
    );
    expect(ownerLogin.status).toBe(200);
    const safeLoginBody = await ownerLogin.text();
    expect(safeLoginBody).not.toMatch(/token|session|access.?key/i);
    const ownerCookie = ownerLogin.headers.get("set-cookie")?.split(";")[0];
    expect(ownerCookie).toContain("eventos-tenant");
    if (!ownerCookie)
      throw new Error("Tenant sign-in did not set a session cookie.");
    const ownerSessionHeaders = new Headers({
      host: `${slugA}.localhost:3000`,
      cookie: ownerCookie,
    });
    const ownerActor = await requireTenantActor(
      ownerContext,
      `http://${slugA}.localhost:3000`,
      ownerSessionHeaders,
    );
    expect(ownerActor.tenantId).toBe(first.tenant.id);
    expect(ownerActor.permissions.size).toBe(42);
    const websiteBefore = await getWebsiteProfile(ownerContext);
    const websiteOrigin = `http://${slugA}.localhost:3000`;
    const websiteInput = {
      ...websiteBefore,
      shortDescription: "معرفی عمومی آزمایشی",
      phone: "021-00000000",
      primaryColor: "#145d58",
      heroEnabled: false,
      siteSettings: {
        ...websiteBefore.siteSettings,
        sections: { ...websiteBefore.siteSettings.sections, about: false },
      },
    };
    const websiteRequest = (input: unknown, cookie = ownerCookie) =>
      new Request(`${websiteOrigin}/api/tenant/website`, {
        method: "PUT",
        headers: {
          host: `${slugA}.localhost:3000`,
          origin: websiteOrigin,
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    const websiteSave = await putWebsiteProfile(websiteRequest(websiteInput));
    expect(websiteSave.status).toBe(200);
    expect(await getWebsiteProfile(ownerContext)).toMatchObject({
      shortDescription: "معرفی عمومی آزمایشی",
      phone: "021-00000000",
      primaryColor: "#145d58",
      heroEnabled: false,
      siteSettings: { sections: { about: false } },
    });
    const invalidWebsite = await putWebsiteProfile(
      websiteRequest({ ...websiteInput, primaryColor: "javascript:alert(1)" }),
    );
    expect(invalidWebsite.status).toBe(400);
    expect((await invalidWebsite.json()).error.message).toContain("رنگ اصلی");
    const invalidSection = await putWebsiteProfile(
      websiteRequest({
        ...websiteInput,
        siteSettings: {
          ...websiteInput.siteSettings,
          heroCtaHref: "javascript:alert(1)",
        },
      }),
    );
    expect(invalidSection.status).toBe(400);
    const logo = await saveMedia(
      ownerContext,
      ownerActor,
      "WEBSITE_LOGO",
      ownerContext.tenantId,
      "image/png",
      Uint8Array.from(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=",
          "base64",
        ),
      ),
      randomUUID(),
    );
    expect(logo.url).toMatch(/^\/api\/media\//);
    const ownMedia = await getPublicMedia(
      new Request(`${websiteOrigin}${logo.url}`, {
        headers: { host: `${slugA}.localhost:3000` },
      }),
      { params: Promise.resolve({ id: logo.id }) },
    );
    expect(ownMedia.status).toBe(200);
    const profileWithLogo = await putWebsiteProfile(
      websiteRequest({ ...websiteInput, logoUrl: logo.url }),
    );
    expect(profileWithLogo.status).toBe(200);
    const unauthenticatedWebsite = await putWebsiteProfile(
      websiteRequest(websiteInput, ""),
    );
    expect(unauthenticatedWebsite.status).toBe(401);
    const participantEmail = `participant-${randomUUID()}@example.test`;
    const authRequest = (
      path: string,
      input: unknown,
      host = `${slugA}.localhost:3000`,
    ) =>
      new Request(`http://${host}/api/tenant-auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://${host}`,
          host,
        },
        body: JSON.stringify(input),
      });
    const signUp = await tenantAuthPost(
      authRequest("/sign-up/email", {
        name: "Synthetic Participant",
        email: participantEmail,
        password: "safe participant password 123",
        callbackURL: "/account",
      }),
    );
    expect(signUp.status).toBe(200);
    const participantRows = await getTenantPool(ownerContext).query(
      `SELECT user_id FROM tenant_participant_profiles WHERE tenant_id=$1
       AND user_id=(SELECT id FROM tenant_users WHERE "tenantId"=$1 AND email=$2)`,
      [first.tenant.id, participantEmail],
    );
    expect(participantRows.rowCount).toBe(1);
    const verificationMessages = (await readFile(testMailOutbox, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { email: string; text: string });
    const verificationMessage = verificationMessages.find(
      (entry) => entry.email === participantEmail,
    );
    expect(verificationMessage).toBeDefined();
    const verificationUrl =
      verificationMessage?.text.match(/https?:\/\/\S+/)?.[0];
    if (!verificationUrl)
      throw new Error("Participant verification email was not delivered.");
    const verify = await tenantAuthGet(
      new Request(verificationUrl, {
        headers: { host: `${slugA}.localhost:3000` },
      }),
    );
    expect(verify.status).toBeLessThan(400);
    const participantVerified = await getTenantPool(ownerContext).query<{
      emailVerified: boolean;
    }>(
      `SELECT "emailVerified" FROM tenant_users WHERE "tenantId"=$1 AND email=$2`,
      [first.tenant.id, participantEmail],
    );
    expect(participantVerified.rows[0]?.emailVerified).toBe(true);
    const disabledOtp = await tenantAuthPost(
      authRequest("/email-otp/send-verification-otp", {
        email: participantEmail,
        type: "sign-in",
      }),
    );
    expect(disabledOtp.status).toBe(403);
    for (const tenantId of [first.tenant.id]) {
      await getControlPool().query(
        `INSERT INTO tenant_features (tenant_id,feature_key,enabled,updated_by) VALUES ($1,'email_otp',true,$2)
         ON CONFLICT (tenant_id,feature_key) DO UPDATE SET enabled=true,updated_by=$2`,
        [tenantId, adminId],
      );
      invalidateTenantResolutionCache(tenantId);
    }
    const requestedOtp = await tenantAuthPost(
      authRequest("/email-otp/send-verification-otp", {
        email: participantEmail,
        type: "sign-in",
      }),
    );
    expect(requestedOtp.status).toBe(200);
    const otpMessages = (await readFile(testMailOutbox, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { email: string; text: string });
    const otpText = otpMessages
      .filter((entry) => entry.email === participantEmail)
      .at(-1)?.text;
    const otp = otpText?.match(/\b\d{6}\b/)?.[0];
    if (!otp) throw new Error("Tenant OTP message was not delivered.");
    const otpLogin = await tenantAuthPost(
      authRequest("/sign-in/email-otp", { email: participantEmail, otp }),
    );
    expect(otpLogin.status).toBe(200);
    expect(await otpLogin.text()).not.toMatch(/token|session|access.?key/i);
    const replay = await tenantAuthPost(
      authRequest("/sign-in/email-otp", { email: participantEmail, otp }),
    );
    expect(replay.status).not.toBe(200);
    for (const tenantId of [first.tenant.id]) {
      await getControlPool().query(
        "DELETE FROM tenant_features WHERE tenant_id=$1 AND feature_key='email_otp'",
        [tenantId],
      );
      invalidateTenantResolutionCache(tenantId);
    }
    await expect(
      updateTenantUserStatus(
        ownerContext,
        ownerActor.id,
        "SUSPENDED",
        ownerActor,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const ownerOrigin = `http://${slugA}.localhost:3000`;
    const readOnlyRole = await createTenantRole(
      ownerContext,
      {
        code: "integration_read_only",
        name: "Integration Read Only",
        description: "Read-only staff access for integration verification.",
        permissionKeys: ["dashboard.read", "staff.read"],
      },
      ownerActor,
      randomUUID(),
    );
    const staffEmail = `staff-${slugA}@example.test`;
    const invitedStaff = await issueTenantUserInvitation(
      ownerContext,
      {
        name: "Integration Staff",
        email: staffEmail,
        roleCodes: [readOnlyRole.code],
      },
      ownerActor,
      randomUUID(),
      ownerOrigin,
    );
    const refreshedOutbox = (await readFile(testMailOutbox, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { email: string; inviteUrl: string });
    const staffInvite = refreshedOutbox.find(
      (entry) => entry.email === staffEmail,
    );
    expect(staffInvite).toBeDefined();
    if (!staffInvite) throw new Error("Staff invitation was not delivered.");
    const staffToken = new URL(staffInvite.inviteUrl).searchParams.get("token");
    if (!staffToken) throw new Error("Staff invitation link was malformed.");
    const staffTokenHash = await getTenantPool(ownerContext).query<{
      token_hash: string;
    }>("SELECT token_hash FROM tenant_invitations WHERE user_id = $1", [
      invitedStaff.userId,
    ]);
    expect(staffTokenHash.rows[0]?.token_hash).toBe(
      createHash("sha256").update(staffToken).digest("hex"),
    );
    expect(staffTokenHash.rows[0]?.token_hash).not.toBe(staffToken);

    const raceEmail = `race-${slugA}@example.test`;
    const invitationRace = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        issueTenantUserInvitation(
          ownerContext,
          {
            name: "Concurrent Invite",
            email: raceEmail,
            roleCodes: [readOnlyRole.code],
          },
          ownerActor,
          randomUUID(),
          ownerOrigin,
        ),
      ),
    );
    expect(
      invitationRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      invitationRace.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const raceRows = await getTenantPool(ownerContext).query<{
      user_count: number;
      pending_count: number;
    }>(
      `SELECT count(DISTINCT account.id)::int AS user_count,
              count(invitation.id)::int AS pending_count
       FROM tenant_users AS account LEFT JOIN tenant_invitations AS invitation
         ON invitation.tenant_id = account."tenantId" AND invitation.user_id = account.id
        AND invitation.consumed_at IS NULL AND invitation.revoked_at IS NULL AND invitation.expires_at > now()
       WHERE account."tenantId" = $1 AND account.email = $2`,
      [first.tenant.id, raceEmail],
    );
    expect(raceRows.rows[0]).toEqual({ user_count: 1, pending_count: 1 });

    const expiredEmail = `expired-${slugA}@example.test`;
    const expiredInvite = await issueTenantUserInvitation(
      ownerContext,
      {
        name: "Expired Invitation",
        email: expiredEmail,
        roleCodes: [readOnlyRole.code],
      },
      ownerActor,
      randomUUID(),
      ownerOrigin,
    );
    const expiredMail = refreshedOutbox.find(
      (entry) => entry.email === expiredEmail,
    );
    expect(expiredMail).toBeUndefined();
    const expiredLink = (await readFile(testMailOutbox, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { email: string; inviteUrl: string })
      .find((entry) => entry.email === expiredEmail);
    expect(expiredLink).toBeDefined();
    if (!expiredLink) throw new Error("Expired invitation was not delivered.");
    const expiredToken = new URL(expiredLink.inviteUrl).searchParams.get(
      "token",
    );
    if (!expiredToken)
      throw new Error("Expired invitation link was malformed.");
    await getTenantPool(ownerContext).query(
      "UPDATE tenant_invitations SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [expiredInvite.userId],
    );
    await expect(
      acceptTenantInvitation(
        ownerContext,
        expiredToken,
        "expired invite password is long",
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const acceptanceRace = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        acceptTenantInvitation(
          ownerContext,
          staffToken,
          "integration staff password is long",
          randomUUID(),
        ),
      ),
    );
    expect(
      acceptanceRace.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      acceptanceRace.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const lowLogin = await tenantAuthPost(
      new Request(`${ownerOrigin}/api/tenant-auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ownerOrigin,
          host: `${slugA}.localhost:3000`,
        },
        body: JSON.stringify({
          email: staffEmail,
          password: "integration staff password is long",
        }),
      }),
    );
    expect(lowLogin.status).toBe(200);
    const lowCookie = lowLogin.headers.get("set-cookie")?.split(";")[0];
    if (!lowCookie) throw new Error("Staff session cookie was not set.");
    const lowActor = await requireTenantActor(
      ownerContext,
      ownerOrigin,
      new Headers({ host: `${slugA}.localhost:3000`, cookie: lowCookie }),
    );
    expect(lowActor.permissions.has("staff.read")).toBe(true);
    expect(lowActor.permissions.has("finance.read")).toBe(false);
    expect(lowActor.permissions.has("role.read")).toBe(false);
    await expect(
      createTenantRole(
        ownerContext,
        {
          code: "integration_escalation",
          name: "Unauthorized Finance Role",
          description: "",
          permissionKeys: ["finance.read"],
        },
        lowActor,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assignTenantUserRoles(
        ownerContext,
        invitedStaff.userId,
        ["organization_owner"],
        lowActor,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateTenantUserStatus(
        ownerContext,
        invitedStaff.userId,
        "DISABLED",
        lowActor,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const staffHeaders = {
      host: `${slugA}.localhost:3000`,
      origin: ownerOrigin,
      cookie: lowCookie,
    };
    const staffListResponse = await getTenantStaff(
      new Request(`${ownerOrigin}/api/tenant/identity/staff`, {
        headers: staffHeaders,
      }),
    );
    expect(staffListResponse.status).toBe(200);
    const rolesDenied = await getTenantRoles(
      new Request(`${ownerOrigin}/api/tenant/roles`, {
        headers: staffHeaders,
      }),
    );
    expect(rolesDenied.status).toBe(403);
    const staffInviteDenied = await postTenantStaff(
      new Request(`${ownerOrigin}/api/tenant/identity/staff`, {
        method: "POST",
        headers: { ...staffHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized User",
          email: `unauthorized-${slugA}@example.test`,
          roleCodes: [readOnlyRole.code],
        }),
      }),
    );
    expect(staffInviteDenied.status).toBe(403);
    await updateTenantRole(
      ownerContext,
      readOnlyRole.id,
      {
        name: "Integration Read Only",
        description: "Fresh permission refresh test.",
        permissionKeys: ["dashboard.read"],
      },
      ownerActor,
      randomUUID(),
    );
    const permissionRemovedActor = await requireTenantActor(
      ownerContext,
      ownerOrigin,
      new Headers({ host: `${slugA}.localhost:3000`, cookie: lowCookie }),
    );
    expect(permissionRemovedActor.permissions.has("staff.read")).toBe(false);
    const freshStaffDenied = await getTenantStaff(
      new Request(`${ownerOrigin}/api/tenant/identity/staff`, {
        headers: staffHeaders,
      }),
    );
    expect(freshStaffDenied.status).toBe(403);
    await updateTenantRole(
      ownerContext,
      readOnlyRole.id,
      {
        name: "Integration Read Only",
        description: "Restored read-only staff access.",
        permissionKeys: ["dashboard.read", "staff.read"],
      },
      ownerActor,
      randomUUID(),
    );
    const permissionAddedActor = await requireTenantActor(
      ownerContext,
      ownerOrigin,
      new Headers({ host: `${slugA}.localhost:3000`, cookie: lowCookie }),
    );
    expect(permissionAddedActor.permissions.has("staff.read")).toBe(true);
    await assignTenantUserRoles(
      ownerContext,
      invitedStaff.userId,
      [],
      ownerActor,
      randomUUID(),
    );
    const freshActor = await requireTenantActor(
      ownerContext,
      ownerOrigin,
      new Headers({ host: `${slugA}.localhost:3000`, cookie: lowCookie }),
    );
    expect(freshActor.permissions.has("staff.read")).toBe(false);
    await assignTenantUserRoles(
      ownerContext,
      invitedStaff.userId,
      [readOnlyRole.code],
      ownerActor,
      randomUUID(),
    );
    await Promise.all([
      assignTenantUserRoles(
        ownerContext,
        invitedStaff.userId,
        [readOnlyRole.code],
        ownerActor,
        randomUUID(),
      ),
      assignTenantUserRoles(
        ownerContext,
        invitedStaff.userId,
        [readOnlyRole.code],
        ownerActor,
        randomUUID(),
      ),
    ]);
    const roleAssignmentCount = await getTenantPool(ownerContext).query<{
      count: number;
    }>(
      `SELECT count(*)::int AS count FROM tenant_user_roles AS user_role
       JOIN tenant_roles AS role ON role.tenant_id = user_role.tenant_id AND role.id = user_role.role_id
       WHERE user_role.tenant_id = $1 AND user_role.user_id = $2 AND role.code = $3`,
      [first.tenant.id, invitedStaff.userId, readOnlyRole.code],
    );
    expect(roleAssignmentCount.rows[0]?.count).toBe(1);
    const rbacAudit = await getTenantPool(ownerContext).query<{
      action: string;
    }>(
      `SELECT action FROM tenant_audit_logs WHERE tenant_id = $1 AND
       ((target_id = $2 AND action IN ('user.role_assigned', 'user.role_removed')) OR
        (target_id = $3 AND action IN ('role.permission_added', 'role.permission_removed')))
       ORDER BY action`,
      [first.tenant.id, invitedStaff.userId, readOnlyRole.id],
    );
    expect(rbacAudit.rows.map((item) => item.action)).toEqual([
      "role.permission_added",
      "role.permission_removed",
      "user.role_assigned",
      "user.role_removed",
    ]);
    await updateTenantUserStatus(
      ownerContext,
      invitedStaff.userId,
      "SUSPENDED",
      ownerActor,
      randomUUID(),
    );
    await expect(
      requireTenantActor(
        ownerContext,
        ownerOrigin,
        new Headers({ host: `${slugA}.localhost:3000`, cookie: lowCookie }),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const suspensionAudit = await getTenantPool(ownerContext).query<{
      action: string;
      after_state: Record<string, unknown> | null;
    }>(
      `SELECT action, after_state FROM tenant_audit_logs
       WHERE tenant_id = $1 AND target_id = $2
         AND action IN ('staff.suspended', 'session.revoked') ORDER BY action`,
      [first.tenant.id, invitedStaff.userId],
    );
    expect(suspensionAudit.rows.map((item) => item.action)).toEqual([
      "session.revoked",
      "staff.suspended",
    ]);
    expect(suspensionAudit.rows[0]?.after_state).toMatchObject({
      count: 1,
      reason: "account_status_changed",
    });
    expect(JSON.stringify(suspensionAudit.rows)).not.toMatch(
      /password|token|cookie|session.?id/i,
    );

    const slugB = `test-${randomUUID().slice(0, 8)}`;
    await stopWorker(worker);
    const second = await createTenant(
      {
        slug: slugB,
        legalName: "Integration Test B",
        displayName: "Test Organization B",
        planCode: "foundation",
        ownerName: "Second Tenant Owner",
        ownerEmail: `owner-${slugB}@example.test`,
      },
      actor,
      randomUUID(),
    );
    cleanupTenantIds.push(second.tenant.id);
    const boss = await getProvisioningBoss();
    const duplicateQueueIds = await Promise.all(
      Array.from({ length: 2 }, () =>
        boss.send(
          provisioningQueueName,
          {
            provisioningJobId: second.provisioning.jobId,
            tenantId: second.tenant.id,
          },
          { retryLimit: 0, singletonKey: `duplicate-${randomUUID()}` },
        ),
      ),
    );
    expect(new Set(duplicateQueueIds).size).toBe(2);
    const raceWorkers = await Promise.all([startWorker(), startWorker()]);
    const readyB = await waitForState(second.tenant.id, "ACTIVE");
    expect(readyB.database_name).not.toBe(readyA.database_name);
    const activeTransitions = await getControlPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM provisioning_job_transitions
       WHERE job_id = $1 AND to_state = 'ACTIVE'`,
      [second.provisioning.jobId],
    );
    expect(activeTransitions.rows[0]?.count).toBe(1);
    const duplicateSeeds = new Client({
      connectionString: new URL(
        `/${readyB.database_name}`,
        runtimeUrl,
      ).toString(),
    });
    await duplicateSeeds.connect();
    try {
      const roles = await duplicateSeeds.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM tenant_role_templates",
      );
      const migrations = await duplicateSeeds.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM eventos_schema_migrations",
      );
      expect(roles.rows[0]?.count).toBe(11);
      expect(migrations.rows[0]?.count).toBe(1);
    } finally {
      await duplicateSeeds.end();
    }
    await Promise.all(raceWorkers.map(stopWorker));

    clearTenantResolutionCacheForTests();
    const [contextA, contextB] = await Promise.all([
      resolveTenantContext(`${slugA}.localhost`),
      resolveTenantContext(`${slugB}.localhost`),
    ]);
    expect(contextA.tenantId).toBe(first.tenant.id);
    expect(contextB.tenantId).toBe(second.tenant.id);
    expect(contextA.databaseName).not.toBe(contextB.databaseName);
    const wrongMedia = await getPublicMedia(
      new Request(`http://${slugB}.localhost:3000${logo.url}`, {
        headers: { host: `${slugB}.localhost:3000` },
      }),
      { params: Promise.resolve({ id: logo.id }) },
    );
    expect(wrongMedia.status).toBe(404);
    await removeMedia(
      ownerContext,
      ownerActor,
      "WEBSITE_LOGO",
      ownerContext.tenantId,
      randomUUID(),
    );
    expect(contextA.features.custom_domain).toBe(false);
    for (const tenantId of [first.tenant.id, second.tenant.id]) {
      await getControlPool().query(
        `INSERT INTO tenant_features (tenant_id,feature_key,enabled,updated_by) VALUES ($1,'email_otp',true,$2)
         ON CONFLICT (tenant_id,feature_key) DO UPDATE SET enabled=true,updated_by=$2`,
        [tenantId, adminId],
      );
      invalidateTenantResolutionCache(tenantId);
    }
    const crossTenantChallenge = await tenantAuthPost(
      authRequest("/email-otp/send-verification-otp", {
        email: participantEmail,
        type: "sign-in",
      }),
    );
    expect(crossTenantChallenge.status).toBe(200);
    const crossTenantMessages = (await readFile(testMailOutbox, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { email: string; text: string });
    const crossTenantCode = crossTenantMessages
      .filter((entry) => entry.email === participantEmail)
      .at(-1)
      ?.text.match(/\b\d{6}\b/)?.[0];
    if (!crossTenantCode)
      throw new Error("Cross-tenant OTP fixture was not delivered.");
    const crossTenantAttempt = await tenantAuthPost(
      authRequest(
        "/sign-in/email-otp",
        { email: participantEmail, otp: crossTenantCode },
        `${slugB}.localhost:3000`,
      ),
    );
    expect(crossTenantAttempt.status).not.toBe(200);
    const correctTenantAttempt = await tenantAuthPost(
      authRequest("/sign-in/email-otp", {
        email: participantEmail,
        otp: crossTenantCode,
      }),
    );
    expect(correctTenantAttempt.status).toBe(200);
    for (const tenantId of [first.tenant.id, second.tenant.id]) {
      await getControlPool().query(
        "DELETE FROM tenant_features WHERE tenant_id=$1 AND feature_key='email_otp'",
        [tenantId],
      );
      invalidateTenantResolutionCache(tenantId);
    }
    await Promise.all([
      resolveTenantContext(`${slugA}.localhost`),
      resolveTenantContext(`${slugB}.localhost`),
    ]);
    await expect(
      assignTenantUserRoles(
        contextB,
        invitedStaff.userId,
        ["support"],
        ownerActor,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const tenantBUserCheck = await getTenantPool(contextB).query(
      'SELECT id FROM tenant_users WHERE id = $1 AND "tenantId" = $2',
      [invitedStaff.userId, second.tenant.id],
    );
    expect(tenantBUserCheck.rowCount).toBe(0);
    await expect(
      requireTenantActor(
        contextB,
        `http://${slugB}.localhost:3000`,
        new Headers({ host: `${slugB}.localhost:3000`, cookie: ownerCookie }),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const wrongTenantInvitation = await acceptTenantInvitationRoute(
      new Request(
        `http://${slugB}.localhost:3000/api/tenant/invitations/accept`,
        {
          method: "POST",
          headers: {
            host: `${slugB}.localhost:3000`,
            origin: `http://${slugB}.localhost:3000`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            token: invitationToken,
            password: "wrong tenant acceptance attempt",
          }),
        },
      ),
    );
    expect(wrongTenantInvitation.status).toBe(400);
    const observed = await Promise.all(
      Array.from({ length: 30 }, (_, index) => {
        const context = index % 2 ? contextB : contextA;
        return getTenantPool(context).query<{
          current_database: string;
          tenant_id: string;
        }>("SELECT current_database(), $1::text AS tenant_id", [
          context.tenantId,
        ]);
      }),
    );
    for (const [index, response] of observed.entries()) {
      const context = index % 2 ? contextB : contextA;
      expect(response.rows[0]?.current_database).toBe(context.databaseName);
      expect(response.rows[0]?.tenant_id).toBe(context.tenantId);
    }
    expect(tenantResolutionCacheSize()).toBe(2);

    await updateTenantFeatures(
      first.tenant.id,
      [{ key: "custom_domain", enabled: true }],
      actor,
      randomUUID(),
    );
    await updateTenantLimits(
      first.tenant.id,
      [{ key: "max_custom_domains", value: 1 }],
      actor,
      randomUUID(),
    );
    expect(
      (await resolveTenantContext(`${slugA}.localhost`)).features.custom_domain,
    ).toBe(false);
    invalidateTenantResolutionCache(first.tenant.id);
    const updatedContextA = await resolveTenantContext(`${slugA}.localhost`);
    expect(updatedContextA.features.custom_domain).toBe(true);
    expect(updatedContextA.limits.max_custom_domains).toBe(1);
    const custom = await createCustomDomain(
      first.tenant.id,
      {
        hostname: `pending-${randomUUID().slice(0, 8)}.integration.example`,
        isPrimary: false,
      },
      actor,
      randomUUID(),
    );
    expect(custom.verification.recordValue).toMatch(/^eventos-verification=/);
    const token = custom.verification.recordValue.slice(
      "eventos-verification=".length,
    );
    const savedChallenge = await getControlPool().query<{
      verification_token_hash: string;
    }>("SELECT verification_token_hash FROM tenant_domains WHERE id = $1", [
      custom.domain.id,
    ]);
    expect(savedChallenge.rows[0]?.verification_token_hash).not.toBe(token);
    await expect(
      resolveTenantContext(custom.domain.hostname),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    vi.mocked(resolveTxt).mockResolvedValueOnce([
      [`eventos-verification=${token}`],
    ]);
    const verified = await verifyCustomDomain(
      first.tenant.id,
      custom.domain.id,
      actor,
      randomUUID(),
    );
    expect(verified.verified).toBe(true);
    invalidateTenantResolutionCache(first.tenant.id);
    expect(
      (await resolveTenantContext(`${custom.domain.hostname}.`)).tenantId,
    ).toBe(first.tenant.id);
    await expect(
      resolveTenantContext(`nested.${custom.domain.hostname}`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      resolveTenantContext(`unverified-${randomUUID().slice(0, 8)}.example`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      resolveTenantContext(`unknown-${randomUUID().slice(0, 8)}.localhost`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await changeTenantStatus(first.tenant.id, "SUSPENDED", actor, randomUUID());
    invalidateTenantResolutionCache(first.tenant.id);
    await expect(
      resolveTenantContext(`${slugA}.localhost`),
    ).rejects.toMatchObject({ code: "TENANT_NOT_ACTIVE" });
    const poolEnd = vi.spyOn((await import("pg")).Pool.prototype, "end");
    for (let index = 0; index < 20; index += 1) {
      const tenantId = randomUUID();
      getTenantPool({
        ...contextB,
        tenantId,
        databaseName: `eventos_t_${tenantId.replaceAll("-", "")}`,
      });
    }
    expect(tenantPoolCacheSize()).toBe(16);
    expect(poolEnd).toHaveBeenCalled();
    poolEnd.mockRestore();

    const audit = await getControlPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM platform_audit_logs
       WHERE target_id = $1 AND actor_id = $2`,
      [first.tenant.id, adminId],
    );
    expect(audit.rows[0]?.count).toBeGreaterThanOrEqual(4);
    const createAudit = await getControlPool().query<{
      actor_id: string;
      target_type: string;
      target_id: string;
      request_id: string;
    }>(
      `SELECT actor_id, target_type, target_id, request_id FROM platform_audit_logs
       WHERE action = 'tenant.created' AND target_id = $1 AND request_id = $2`,
      [first.tenant.id, createRequestId],
    );
    expect(createAudit.rows[0]).toMatchObject({
      actor_id: adminId,
      target_type: "TENANT",
      target_id: first.tenant.id,
      request_id: createRequestId,
    });
    await stopWorker(worker);
  }, 180_000);

  it("upgrades a Phase 1 tenant database in place and safely repeats the migration command", async () => {
    const actor = {
      adminId,
      userId: "integration-test",
      email: adminEmail,
      name: "Integration Test",
      twoFactorEnabled: true,
    } as const;
    const slug = `test-${randomUUID().slice(0, 8)}`;
    const created = await createTenant(
      {
        slug,
        legalName: "Legacy Tenant Upgrade Test",
        displayName: "Legacy Tenant Upgrade Test",
        planCode: "foundation",
        ownerName: "Legacy Tenant Owner",
        ownerEmail: `owner-${slug}@example.test`,
      },
      actor,
      randomUUID(),
    );
    cleanupTenantIds.push(created.tenant.id);
    const registry = await getControlPool().query<{
      database_name: string;
    }>(
      "SELECT database_name FROM tenant_database_registry WHERE tenant_id = $1",
      [created.tenant.id],
    );
    const databaseName = registry.rows[0]?.database_name;
    if (!databaseName || !/^eventos_t_[0-9a-f]{32}$/.test(databaseName)) {
      throw new Error("The legacy tenant database name was invalid.");
    }
    const provisioner = new Client({
      connectionString: process.env.TENANT_PROVISIONING_DATABASE_URL,
    });
    await provisioner.connect();
    try {
      await provisioner.query(
        `CREATE DATABASE "${databaseName}" OWNER eventos_tenant_owner`,
      );
      await provisioner.query(
        `GRANT CONNECT ON DATABASE "${databaseName}" TO eventos_tenant_runtime, eventos_tenant_migrator`,
      );
    } finally {
      await provisioner.end();
    }

    const databaseUrl = new URL(
      `/${databaseName}`,
      process.env.TENANT_MIGRATION_DATABASE_URL,
    );
    const legacyDb = new Client({ connectionString: databaseUrl.toString() });
    await legacyDb.connect();
    try {
      await legacyDb.query("SET ROLE eventos_tenant_owner");
      await applySqlMigrations(
        legacyDb,
        path.join(
          process.cwd(),
          "src",
          "infrastructure",
          "db",
          "tenant",
          "migrations",
        ),
        `tenant-${created.tenant.id}`,
      );
      await legacyDb.query(
        "GRANT USAGE ON SCHEMA public TO eventos_tenant_runtime",
      );
      await legacyDb.query(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eventos_tenant_runtime",
      );
      await legacyDb.query(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eventos_tenant_runtime",
      );
      await legacyDb.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eventos_tenant_runtime",
      );
      await legacyDb.query(
        "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eventos_tenant_runtime",
      );
      await legacyDb.query("BEGIN");
      await legacyDb.query(
        `INSERT INTO tenant_metadata (singleton, tenant_id, slug, schema_version)
         VALUES (true, $1, $2, '0001_tenant_foundation')`,
        [created.tenant.id, slug],
      );
      await legacyDb.query(
        "INSERT INTO tenant_schema_migrations (version) VALUES ('0001_tenant_foundation')",
      );
      await legacyDb.query("COMMIT");
      await legacyDb.query("RESET ROLE");
    } catch (error) {
      await legacyDb.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await legacyDb.end();
    }
    await getControlPool().query(
      "UPDATE tenants SET status = 'ACTIVE' WHERE id = $1",
      [created.tenant.id],
    );
    await getControlPool().query(
      `UPDATE tenant_database_registry SET migration_version = '0001_tenant_foundation', last_health_state = 'HEALTHY'
       WHERE tenant_id = $1`,
      [created.tenant.id],
    );

    await runTenantMigrationCommand();
    const firstUpgrade = await getControlPool().query<{
      migration_version: string;
      audit_count: number;
    }>(
      `SELECT registry.migration_version,
              (SELECT count(*)::int FROM platform_audit_logs
               WHERE action = 'tenant.schema_migrated' AND target_id = $2::text) AS audit_count
       FROM tenant_database_registry AS registry WHERE registry.tenant_id = $1`,
      [created.tenant.id, created.tenant.id],
    );
    expect(firstUpgrade.rows[0]).toEqual({
      migration_version: "0007_organization_site_media",
      audit_count: 1,
    });

    await runTenantMigrationCommand();
    const secondUpgrade = await getControlPool().query<{
      audit_count: number;
    }>(
      `SELECT count(*)::int AS audit_count FROM platform_audit_logs
       WHERE action = 'tenant.schema_migrated' AND target_id = $1::text`,
      [created.tenant.id],
    );
    expect(secondUpgrade.rows[0]?.audit_count).toBe(1);
    const upgraded = new Client({ connectionString: databaseUrl.toString() });
    await upgraded.connect();
    try {
      const metadata = await upgraded.query<{
        schema_version: string;
      }>("SELECT schema_version FROM tenant_metadata WHERE singleton = true");
      const identity = await upgraded.query<{
        roles: number;
        permissions: number;
        owner_grants: number;
      }>(
        `SELECT (SELECT count(*)::int FROM tenant_roles WHERE tenant_id = $1) AS roles,
                (SELECT count(*)::int FROM tenant_permissions WHERE tenant_id = $1) AS permissions,
                (SELECT count(*)::int FROM tenant_role_permissions AS grant_row
                 JOIN tenant_roles AS role ON role.tenant_id = grant_row.tenant_id AND role.id = grant_row.role_id
                 WHERE role.tenant_id = $1 AND role.code = 'organization_owner') AS owner_grants`,
        [created.tenant.id],
      );
      const history = await upgraded.query<{
        phase1_rows: number;
        identity_rows: number;
        prisma_rows: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM eventos_schema_migrations) AS phase1_rows,
           (SELECT count(*)::int FROM tenant_schema_migrations) AS identity_rows,
           (SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS prisma_rows`,
      );
      expect(metadata.rows[0]?.schema_version).toBe(
        "0007_organization_site_media",
      );
      expect(identity.rows[0]).toEqual({
        roles: 11,
        permissions: 42,
        owner_grants: 42,
      });
      expect(history.rows[0]).toEqual({
        phase1_rows: 1,
        identity_rows: 2,
        prisma_rows: 8,
      });
    } finally {
      await upgraded.end();
    }
  }, 180_000);

  it("returns generic unauthenticated/CSRF denials for protected mutation routes", async () => {
    const platformHost = new URL(
      process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ).host;
    const unauthenticated = await getTenants(
      new Request("http://localhost:3000/api/platform/tenants", {
        headers: { host: platformHost },
      }),
    );
    expect(unauthenticated.status).toBe(401);
    const missingOrigin = await createTenantRoute(
      new Request("http://localhost:3000/api/platform/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", host: platformHost },
        body: JSON.stringify({
          slug: "denied-test",
          legalName: "Denied",
          displayName: "Denied",
          planCode: "foundation",
        }),
      }),
    );
    expect(missingOrigin.status).toBe(403);
    const crossOrigin = await createTenantRoute(
      new Request("http://localhost:3000/api/platform/tenants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          host: platformHost,
        },
        body: JSON.stringify({
          slug: "denied-test",
          legalName: "Denied",
          displayName: "Denied",
          planCode: "foundation",
        }),
      }),
    );
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("blocks public registration and throttles login without email enumeration", async () => {
    const pool = getControlPool();
    const existingKeys = await pool.query<{ key: string }>(
      'SELECT "key" FROM platform_auth_rate_limits',
    );
    const registeredEmail = `unknown-${randomUUID()}@example.test`;
    const signIn = async (email: string) =>
      getAuth().handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ email, password: "incorrect-password-value" }),
        }),
      );
    try {
      const signup = await getAuth().handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            name: "Public Registration Attempt",
            email: registeredEmail,
            password: "incorrect-password-value",
          }),
        }),
      );
      expect(signup.status).not.toBe(200);
      const signupUser = await pool.query(
        "SELECT id FROM platform_auth_users WHERE email = $1",
        [registeredEmail],
      );
      expect(signupUser.rowCount).toBe(0);

      const unknownResponse = await signIn(registeredEmail);
      const knownResponse = await signIn(adminEmail);
      expect(unknownResponse.status).toBe(401);
      expect(knownResponse.status).toBe(401);
      const unknownBody = (await unknownResponse.json()) as {
        message?: string;
      };
      const knownBody = (await knownResponse.json()) as { message?: string };
      expect(unknownBody.message).toBe(knownBody.message);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await signIn(adminEmail);
      }
      const throttled = await signIn(adminEmail);
      expect(throttled.status).toBe(429);
    } finally {
      await pool.query(
        'DELETE FROM platform_auth_rate_limits WHERE "key" <> ALL($1::text[])',
        [existingKeys.rows.map((row) => row.key)],
      );
    }
  }, 60_000);
});
