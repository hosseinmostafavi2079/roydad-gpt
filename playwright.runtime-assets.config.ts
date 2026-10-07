import { defineConfig } from "@playwright/test";

// Uses existing local demo data, never production or a remote deployment.
if (process.env.CI)
  throw new Error("Runtime asset acceptance requires the local demo fixture.");
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "runtime-assets.spec.ts",
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
