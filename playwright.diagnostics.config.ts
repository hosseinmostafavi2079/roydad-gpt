import { defineConfig } from "@playwright/test";

const origin = "http://localhost:3001";
if (process.env.CI) throw new Error("Diagnostics UI acceptance is local only.");
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "diagnostics-center.spec.ts",
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
