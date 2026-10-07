import { defineConfig } from "@playwright/test";

if (process.env.CI)
  throw new Error("Admin UI acceptance uses local demo only.");
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "platform-admins.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    launchOptions: { channel: "chrome" },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
