import { defineConfig } from "@playwright/test";

// Focused local UI acceptance; existing demo credentials stay outside the repository.
const origin = process.env.EVENTOS_BACKUP_UI_ORIGIN ?? "http://localhost:3001";
const url = new URL(origin);
if (url.hostname !== "localhost" || url.protocol !== "http:" || process.env.CI)
  throw new Error("Backup UI acceptance is restricted to local development.");
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "backup-center.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: origin,
    launchOptions: { channel: "chrome" },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
