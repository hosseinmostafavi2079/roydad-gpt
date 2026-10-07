import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { verifyPlatformPassword } from "@/infrastructure/auth/password";
import {
  activationError,
  PlatformAdminRepository,
} from "@/modules/platform/admins/repository";

if (existsSync(".env")) process.loadEnvFile(".env");
const schema = `admins_${randomUUID().replaceAll("-", "")}`;
let client: Client, pool: Pool, repo: PlatformAdminRepository;
const original = randomUUID(),
  originalUser = randomUUID(),
  requestId = randomUUID();
const password = "A unique platform test password 2026!";
const secrets: string[] = [];
async function create() {
  const email = `admin-${randomUUID()}@example.test`;
  const result = await repo.createPlatformAdmin(
    { email, displayName: "Test Admin" },
    original,
    requestId,
  );
  secrets.push(result.activationCode);
  return { ...result, email };
}
async function activate(value: Awaited<ReturnType<typeof create>>) {
  await repo.activatePlatformAdmin(
    {
      email: value.email,
      activationCode: value.activationCode,
      password,
      confirmPassword: password,
    },
    requestId,
  );
  return value;
}
async function token(id: string) {
  return (
    await pool.query(
      "SELECT * FROM platform_admin_activations WHERE platform_admin_id=$1 ORDER BY created_at DESC LIMIT 1",
      [id],
    )
  ).rows[0];
}
async function admin(id: string) {
  return (await pool.query("SELECT * FROM platform_admins WHERE id=$1", [id]))
    .rows[0];
}
async function session(id: string) {
  const row = await admin(id);
  await pool.query(
    'INSERT INTO platform_auth_sessions(id,token,"userId","expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 hour\',now())',
    [randomUUID(), randomUUID(), row.auth_user_id],
  );
}
async function sessionCount(id: string) {
  return (
    await pool.query(
      'SELECT count(*)::int AS count FROM platform_auth_sessions WHERE "userId"=(SELECT auth_user_id FROM platform_admins WHERE id=$1)',
      [id],
    )
  ).rows[0]?.count;
}
beforeAll(async () => {
  const url = new URL(process.env.CONTROL_MIGRATION_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local PostgreSQL only");
  client = new Client({ connectionString: url.href });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}",public`);
  const directory = path.resolve("src/infrastructure/db/control/migrations");
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    if (file === "0016_platform_admin_management.sql") {
      await client.query(
        "INSERT INTO platform_auth_users(id,name,email,\"emailVerified\") VALUES($1,'Original','original@example.test',true)",
        [originalUser],
      );
      await client.query(
        "INSERT INTO platform_admins(id,auth_user_id,email,display_name,created_at) VALUES($1,$2,'original@example.test','Original','2026-01-01')",
        [original, originalUser],
      );
    }
    await client.query(readFileSync(path.join(directory, file), "utf8"));
  }
  pool = new Pool({
    connectionString: url.href,
    options: `-c search_path=${schema},public`,
    max: 5,
  });
  repo = new PlatformAdminRepository(pool);
});
afterAll(async () => {
  if (pool) await pool.end();
  if (client) {
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  }
});
it("0016 backfills original admin ACTIVE without altering identity", async () => {
  const row = await admin(original);
  expect(row.activated_at).toEqual(row.created_at);
  expect(row.revoked_at).toBeNull();
});
it("creates normalized pending identity without credentials and returns 256-bit code", async () => {
  const value = await create();
  const row = await admin(value.id);
  expect(row.activated_at).toBeNull();
  expect(row.revoked_at).toBeNull();
  expect(Buffer.from(value.activationCode, "base64url").length).toBe(32);
  const accounts = await pool.query(
    'SELECT id FROM platform_auth_accounts WHERE "userId"=$1',
    [row.auth_user_id],
  );
  expect(accounts.rowCount).toBe(0);
  const user = (
    await pool.query(
      'SELECT "emailVerified" FROM platform_auth_users WHERE id=$1',
      [row.auth_user_id],
    )
  ).rows[0];
  expect(user.emailVerified).toBe(false);
  const record = await token(value.id);
  expect(record.token_hash === value.activationCode).toBe(false);
  expect(
    record.token_hash ===
      createHash("sha256").update(value.activationCode).digest("hex"),
  ).toBe(true);
  expect(record.expires_at.getTime() - record.created_at.getTime()).toBe(
    86400000,
  );
});
it("rejects duplicate normalized email without creating another identity", async () => {
  const value = await create();
  await expect(
    repo.createPlatformAdmin(
      { email: value.email.toUpperCase(), displayName: "Duplicate" },
      original,
      requestId,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("requires a real active actor inside the transaction", async () => {
  const value = await create();
  await expect(
    repo.createPlatformAdmin(
      { email: `${randomUUID()}@example.test`, displayName: "Bad Actor" },
      value.id,
      requestId,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("activation constraints reject duplicate usable records and invalid attempt counts", async () => {
  const value = await create();
  await expect(
    pool.query(
      "UPDATE platform_admin_activations SET failed_attempt_count=6 WHERE platform_admin_id=$1",
      [value.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    pool.query(
      "INSERT INTO platform_admin_activations(platform_admin_id,token_hash,expires_at) VALUES($1,$2,now()+interval '24 hours')",
      [value.id, "a".repeat(64)],
    ),
  ).rejects.toMatchObject({ code: "23505" });
});
it("activation stores compatible Argon2 credential, verifies email, consumes token and creates no session", async () => {
  const value = await activate(await create());
  const row = await admin(value.id);
  expect(row.activated_at).toBeInstanceOf(Date);
  const user = (
    await pool.query(
      'SELECT "emailVerified" FROM platform_auth_users WHERE id=$1',
      [row.auth_user_id],
    )
  ).rows[0];
  expect(user.emailVerified).toBe(true);
  const account = (
    await pool.query('SELECT * FROM platform_auth_accounts WHERE "userId"=$1', [
      row.auth_user_id,
    ])
  ).rows[0];
  expect(account.providerId).toBe("credential");
  expect(account.accountId).toBe(row.auth_user_id);
  expect(account.password === password).toBe(false);
  expect(await verifyPlatformPassword(account.password, password)).toBe(true);
  expect((await token(value.id)).consumed_at).toBeInstanceOf(Date);
  expect(await sessionCount(value.id)).toBe(0);
});
it("rejects replay with generic error", async () => {
  const value = await activate(await create());
  await expect(activate(value)).rejects.toThrow(activationError);
});
it("activation replaces any pending recovery credential and removes preactivation sessions", async () => {
  const value = await create();
  const row = await admin(value.id);
  await pool.query(
    'INSERT INTO platform_auth_accounts(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,\'old-recovery-placeholder\',now())',
    [randomUUID(), row.auth_user_id],
  );
  await session(value.id);
  await activate(value);
  const accounts = await pool.query(
    'SELECT password FROM platform_auth_accounts WHERE "userId"=$1',
    [row.auth_user_id],
  );
  expect(accounts.rowCount).toBe(1);
  expect(
    await verifyPlatformPassword(accounts.rows[0]?.password, password),
  ).toBe(true);
  expect(await sessionCount(value.id)).toBe(0);
});
it("rejects expired code with generic error", async () => {
  const value = await create();
  await pool.query(
    "UPDATE platform_admin_activations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE platform_admin_id=$1",
    [value.id],
  );
  await expect(activate(value)).rejects.toThrow(activationError);
});
it("unknown email and wrong code return the same generic error", async () => {
  const value = await create();
  await expect(
    activate({ ...value, activationCode: "incorrect" }),
  ).rejects.toThrow(activationError);
  expect((await token(value.id)).failed_attempt_count).toBe(1);
  await expect(
    activate({ ...value, email: "unknown@example.test" }),
  ).rejects.toThrow(activationError);
});
it("five failed attempts commit counters, lock valid code and recover after lock expiry", async () => {
  const value = await create();
  for (let i = 0; i < 5; i++)
    await expect(
      activate({ ...value, activationCode: "incorrect" }),
    ).rejects.toThrow(activationError);
  expect((await token(value.id)).failed_attempt_count).toBe(5);
  expect((await token(value.id)).locked_until).toBeInstanceOf(Date);
  await expect(activate(value)).rejects.toThrow(activationError);
  await pool.query(
    "UPDATE platform_admin_activations SET locked_until=now()-interval '1 second' WHERE platform_admin_id=$1",
    [value.id],
  );
  await activate(value);
  expect((await token(value.id)).failed_attempt_count).toBe(0);
});
it("concurrent valid activations produce exactly one credential", async () => {
  const value = await create();
  const results = await Promise.allSettled([activate(value), activate(value)]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const row = await admin(value.id);
  expect(
    (
      await pool.query(
        'SELECT id FROM platform_auth_accounts WHERE "userId"=$1',
        [row.auth_user_id],
      )
    ).rowCount,
  ).toBe(1);
});
it("regeneration invalidates old code and fresh code works once", async () => {
  const value = await create();
  const fresh = await repo.regenerateActivation(value.id, original, requestId);
  secrets.push(fresh.activationCode);
  expect(fresh.activationCode === value.activationCode).toBe(false);
  await expect(activate(value)).rejects.toThrow(activationError);
  await activate({ ...value, activationCode: fresh.activationCode });
  await expect(
    repo.regenerateActivation(value.id, original, requestId),
  ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
});
it("revocation removes sessions and reactivation preserves password/MFA without restoring sessions", async () => {
  const value = await activate(await create());
  const row = await admin(value.id);
  await pool.query(
    'UPDATE platform_auth_users SET "twoFactorEnabled"=true WHERE id=$1',
    [row.auth_user_id],
  );
  await pool.query(
    "INSERT INTO platform_admin_two_factors(id,secret,\"backupCodes\",\"userId\") VALUES($1,'test-only-secret','test-only-backup',$2)",
    [randomUUID(), row.auth_user_id],
  );
  const before = (
    await pool.query(
      'SELECT password FROM platform_auth_accounts WHERE "userId"=$1',
      [row.auth_user_id],
    )
  ).rows[0]?.password;
  await session(value.id);
  await repo.revokePlatformAdmin(value.id, original, requestId);
  expect(await sessionCount(value.id)).toBe(0);
  expect((await admin(value.id)).revoked_at).toBeInstanceOf(Date);
  const restored = await repo.reactivatePlatformAdmin(
    value.id,
    original,
    requestId,
  );
  expect(restored.status).toBe("ACTIVE");
  expect("activationCode" in restored).toBe(false);
  expect(await sessionCount(value.id)).toBe(0);
  expect(
    (
      await pool.query(
        'SELECT password FROM platform_auth_accounts WHERE "userId"=$1',
        [row.auth_user_id],
      )
    ).rows[0]?.password === before,
  ).toBe(true);
  expect(
    (
      await pool.query(
        'SELECT "twoFactorEnabled" FROM platform_auth_users WHERE id=$1',
        [row.auth_user_id],
      )
    ).rows[0]?.twoFactorEnabled,
  ).toBe(true);
});
it("revoked pending admin cannot activate; reactivation returns a fresh pending code", async () => {
  const value = await create();
  await repo.revokePlatformAdmin(value.id, original, requestId);
  expect((await token(value.id)).consumed_at).toBeInstanceOf(Date);
  await expect(activate(value)).rejects.toThrow(activationError);
  const restored = await repo.reactivatePlatformAdmin(
    value.id,
    original,
    requestId,
  );
  expect(restored.status).toBe("PENDING_ACTIVATION");
  expect("activationCode" in restored).toBe(true);
  if (!("activationCode" in restored) || !restored.activationCode)
    throw new Error("Missing one-time response");
  secrets.push(restored.activationCode);
  await expect(activate(value)).rejects.toThrow(activationError);
  await activate({ ...value, activationCode: restored.activationCode });
});
it("session revocation keeps admin ACTIVE and credential/MFA untouched", async () => {
  const value = await activate(await create());
  await session(value.id);
  const row = await admin(value.id);
  const before = (
    await pool.query('SELECT * FROM platform_auth_accounts WHERE "userId"=$1', [
      row.auth_user_id,
    ])
  ).rows;
  await repo.revokePlatformAdminSessions(value.id, original, requestId);
  expect(await sessionCount(value.id)).toBe(0);
  expect((await admin(value.id)).revoked_at).toBeNull();
  expect(
    (
      await pool.query(
        'SELECT * FROM platform_auth_accounts WHERE "userId"=$1',
        [row.auth_user_id],
      )
    ).rows,
  ).toEqual(before);
});
it("self session revocation removes the caller session", async () => {
  const value = await activate(await create());
  await session(value.id);
  await repo.revokePlatformAdminSessions(value.id, value.id, requestId);
  expect(await sessionCount(value.id)).toBe(0);
});
it("list exposes safe lifecycle fields and current-user indicator, no secrets", async () => {
  const revoked = await create();
  await repo.revokePlatformAdmin(revoked.id, original, requestId);
  const data = await repo.listPlatformAdmins(original);
  expect(data.items.find((row) => row.id === original)?.isCurrent).toBe(true);
  expect(data.items.some((row) => row.status === "PENDING_ACTIVATION")).toBe(
    true,
  );
  expect(data.items.some((row) => row.status === "REVOKED")).toBe(true);
  const text = JSON.stringify(data);
  expect(
    /token_hash|activationCode|auth_user_id|password|backupCodes|sessions/.test(
      text,
    ),
  ).toBe(false);
  expect(secrets.some((secret) => text.includes(secret))).toBe(false);
});
it("all six audit actions are append-only safe lifecycle events", async () => {
  const rows = (
    await pool.query(
      "SELECT action,after_state FROM platform_audit_logs WHERE target_type='PLATFORM_ADMIN'",
    )
  ).rows;
  for (const action of [
    "created",
    "activated",
    "activation_regenerated",
    "revoked",
    "reactivated",
    "sessions_revoked",
  ])
    expect(rows.some((row) => row.action === `platform_admin.${action}`)).toBe(
      true,
    );
  const text = JSON.stringify(rows);
  expect(secrets.some((secret) => text.includes(secret))).toBe(false);
  expect(/password|token_hash|test-only-secret|backupCodes/.test(text)).toBe(
    false,
  );
  await expect(pool.query("DELETE FROM platform_audit_logs")).rejects.toThrow();
});
it("concurrent revocations and stale actors cannot remove the last ACTIVE admin", async () => {
  // Keep original, revoke all other fixture accounts, then race two mutual revocations.
  const rows = (await repo.listPlatformAdmins(original)).items;
  for (const row of rows)
    if (row.id !== original && row.status === "ACTIVE")
      await repo.revokePlatformAdmin(row.id, original, requestId);
  const second = await activate(await create());
  const outcomes = await Promise.allSettled([
    repo.revokePlatformAdmin(second.id, original, requestId),
    repo.revokePlatformAdmin(original, second.id, requestId),
  ]);
  expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(
    1,
  );
  const survivors = (await repo.listPlatformAdmins(original)).items.filter(
    (row) => row.status === "ACTIVE",
  );
  expect(survivors).toHaveLength(1);
  const remaining = survivors[0];
  if (!remaining) throw new Error("Missing survivor");
  await expect(
    repo.revokePlatformAdmin(remaining.id, remaining.id, requestId),
  ).rejects.toThrow("حداقل یک مدیر فعال");
  if (remaining.id !== original)
    await repo.reactivatePlatformAdmin(original, remaining.id, requestId);
});
it("global activation bucket bounds unknown-email attempts without storing identifiers", async () => {
  await pool.query(
    "UPDATE platform_auth_rate_limits SET count=100,\"lastRequest\"=$1 WHERE key='platform-admin-activation'",
    [Date.now()],
  );
  const value = await create();
  await expect(activate(value)).rejects.toThrow(activationError);
  expect((await token(value.id)).failed_attempt_count).toBe(0);
});
