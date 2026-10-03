import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  MAIL_TRANSPORT: "smtp",
  MEDIA_S3_ALLOW_HTTP_LOCAL: "false",
  PLATFORM_BASE_DOMAIN: "example.net",
  BETTER_AUTH_URL: "https://panel.example.net",
  PUBLIC_HOSTS: "panel.example.net academy.example.net",
  PILOT_TENANT_HOST: "academy.example.net",
  ACME_EMAIL: "ops@example.net",
  BETTER_AUTH_SECRET: "a".repeat(48),
  TENANT_BOOTSTRAP_ENCRYPTION_KEY: "b".repeat(48),
  CONTROL_DATABASE_URL:
    "postgresql://eventos_control_app:password@postgres:5432/eventos_control",
  CONTROL_MIGRATION_DATABASE_URL:
    "postgresql://eventos_control_migrator:password@postgres:5432/eventos_control",
  CONTROL_QUEUE_DATABASE_URL:
    "postgresql://eventos_control_queue:password@postgres:5432/eventos_control",
  TENANT_PROVISIONING_DATABASE_URL:
    "postgresql://eventos_tenant_provisioner:password@postgres:5432/postgres",
  TENANT_RUNTIME_DATABASE_URL:
    "postgresql://eventos_tenant_runtime:password@postgres:5432/postgres",
  TENANT_MIGRATION_DATABASE_URL:
    "postgresql://eventos_tenant_migrator:password@postgres:5432/postgres",
  SMTP_URL: "smtps://account:password@mail.example.net:465",
  SMTP_FROM: "EventOS <security@example.net>",
  MEDIA_S3_ENDPOINT: "https://storage.example.net",
  MEDIA_S3_REGION: "us-east-1",
  MEDIA_S3_BUCKET: "eventos-media",
  MEDIA_S3_ACCESS_KEY_ID: "access-key",
  MEDIA_S3_SECRET_ACCESS_KEY: "secret-key",
};
function run(overrides: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    ["scripts/deploy-preflight.mjs", "--runtime-only"],
    {
      cwd: process.cwd(),
      env: { ...base, ...overrides },
      encoding: "utf8",
    },
  );
}
describe("production deployment preflight", () => {
  it("accepts a production configuration without changing data", () => {
    expect(run().status).toBe(0);
  });
  it("rejects test mail and E2E mock flags", () => {
    expect(run({ MAIL_TRANSPORT: "test" }).status).not.toBe(0);
    expect(run({ EVENTOS_E2E_GOOGLE_MOCK: "true" }).status).not.toBe(0);
  });
  it("rejects unlisted hosts, insecure storage and partial Google credentials", () => {
    expect(run({ PILOT_TENANT_HOST: "other.example.net" }).status).not.toBe(0);
    expect(
      run({ MEDIA_S3_ENDPOINT: "http://storage.example.net" }).status,
    ).not.toBe(0);
    expect(run({ GOOGLE_CLIENT_ID: "one" }).status).not.toBe(0);
  });
  it("does not print secret values in failures", () => {
    const result = run({ SMTP_URL: "invalid-secret-password" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("invalid-secret-password");
  });
});

it("runs read-only local smoke checks against platform and tenant routes", async () => {
  const server = createServer((request, response) => {
    const route = request.url ?? "";
    response.setHeader(
      "content-type",
      route === "/api/health/ready" ? "application/json" : "text/html",
    );
    response.end(
      route === "/api/health/ready"
        ? JSON.stringify({ data: { status: "ready" } })
        : route === "/"
          ? '<html><script src="/_next/static/chunks/test.js"></script></html>'
          : "ok",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server address unavailable.");
  const temporary = mkdtempSync(path.join(tmpdir(), "eventos-smoke-"));
  const envFile = path.join(temporary, "test.env");
  writeFileSync(envFile, "PILOT_TENANT_HOST=academy.example.net\n", {
    mode: 0o600,
  });
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const output = await new Promise<{ code: number | null; stdout: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          ["scripts/smoke-production.mjs", "--local"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              EVENTOS_PRODUCTION_ENV_FILE: envFile,
              SMOKE_PLATFORM_URL: origin,
              SMOKE_TENANT_URL: origin,
            },
          },
        );
        let stdout = "";
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.once("exit", (code) => resolve({ code, stdout }));
      },
    );
    expect(output.code).toBe(0);
    expect(output.stdout).toContain("Production smoke passed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    unlinkSync(envFile);
    rmdirSync(temporary);
  }
});
