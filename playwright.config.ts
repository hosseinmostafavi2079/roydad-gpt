import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.TENANT_BOOTSTRAP_ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
process.env.EVENTOS_TEST_MAIL_OUTBOX ||= path.join(
  os.tmpdir(),
  `eventos-e2e-mail-${randomUUID()}.jsonl`,
);
process.env.MAIL_TRANSPORT = "test";
process.env.GOOGLE_CLIENT_ID ||= "eventos-e2e-google-client";
process.env.GOOGLE_CLIENT_SECRET ||= randomBytes(32).toString("hex");
process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS ||= "e2e-local-tenants";
process.env.EVENTOS_E2E_GOOGLE_MOCK = "true";
process.env.PLATFORM_REQUIRE_MFA =
  process.env.EVENTOS_E2E_REQUIRE_PLATFORM_MFA === "true" ? "true" : "false";
const e2ePort = Number(process.env.EVENTOS_E2E_PORT ?? "3000");
if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65535)
  throw new Error("EVENTOS_E2E_PORT must be an unprivileged TCP port.");
process.env.BETTER_AUTH_URL = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          },
        }
      : {}),
  },
  webServer: {
    command:
      "node --import=./scripts/e2e-server-pid.mjs .next/standalone/server.js",
    url: `http://localhost:${e2ePort}/api/health/live`,
    env: {
      ...process.env,
      NODE_ENV: "production",
      MAIL_TRANSPORT: "test",
      SMTP_URL: process.env.SMTP_URL || "smtps://localhost:465",
      PORT: String(e2ePort),
      EVENTOS_E2E_SERVER_PID_FILE: "tests/.e2e-server.json",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
