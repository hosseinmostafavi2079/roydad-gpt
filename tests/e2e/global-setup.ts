import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export default async function globalSetup(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.NODE_ENV = "test";
  for (const key of [
    "CONTROL_DATABASE_URL",
    "CONTROL_MIGRATION_DATABASE_URL",
    "CONTROL_QUEUE_DATABASE_URL",
    "TENANT_PROVISIONING_DATABASE_URL",
    "TENANT_RUNTIME_DATABASE_URL",
    "TENANT_MIGRATION_DATABASE_URL",
  ]) {
    const value = process.env[key];
    if (!value) throw new Error(`Playwright E2E requires ${key}.`);
    const url = new URL(value);
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
      throw new Error(
        "Playwright E2E requires a local disposable PostgreSQL instance.",
      );
    }
  }
  const email = `e2e-${randomUUID()}@example.test`;
  const password = randomBytes(32).toString("base64url");
  mutableEnv.EVENTOS_E2E_ADMIN_EMAIL = email;
  mutableEnv.EVENTOS_E2E_ADMIN_PASSWORD = password;
  mutableEnv.PLATFORM_BOOTSTRAP_ADMIN_EMAIL = email;
  mutableEnv.PLATFORM_BOOTSTRAP_ADMIN_PASSWORD = password;
  mutableEnv.TENANT_BOOTSTRAP_ENCRYPTION_KEY ||=
    randomBytes(32).toString("hex");
  const configuredOutboxPath = process.env.EVENTOS_TEST_MAIL_OUTBOX;
  const tempRoot = path.resolve(os.tmpdir());
  const mailOutboxPath = configuredOutboxPath
    ? path.resolve(configuredOutboxPath)
    : "";
  if (!mailOutboxPath.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(
      "The E2E invitation outbox must be inside the temp folder.",
    );
  }
  writeFileSync(mailOutboxPath, "", { mode: 0o600 });
  const smsOutbox = path.resolve(process.env.EVENTOS_E2E_SMS_HTTP_OUTBOX ?? "");
  if (!smsOutbox.startsWith(`${tempRoot}${path.sep}eventos-e2e-sms-`))
    throw new Error("Invalid E2E SMS outbox");
  writeFileSync(smsOutbox, "", { mode: 0o600 });

  const seeded = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      "scripts/bootstrap-dev-admin.ts",
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 60_000 },
  );
  if (seeded.status !== 0) {
    throw new Error(
      `Could not seed the temporary E2E administrator: ${seeded.stderr.slice(-1000)}`,
    );
  }
  writeFileSync(
    path.join(process.cwd(), "tests", ".e2e-state.json"),
    JSON.stringify({
      adminEmail: email,
      tenantId: null,
      tenantSlug: null,
      mailOutboxPath,
    }),
    { mode: 0o600 },
  );
}
