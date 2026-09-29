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
    baseURL: "http://localhost:3000",
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
    url: "http://localhost:3000/api/health/live",
    env: {
      ...process.env,
      NODE_ENV: "production",
      SMTP_URL: process.env.SMTP_URL || "smtps://localhost:465",
      PORT: "3000",
      EVENTOS_E2E_SERVER_PID_FILE: "tests/.e2e-server.json",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
