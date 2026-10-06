import { defineConfig } from "@playwright/test";
const origin =
  process.env.EVENTOS_DEVELOPMENT_ORIGIN ?? "http://demo.localhost:3001";
const url = new URL(origin);
if (
  url.hostname !== "demo.localhost" ||
  url.protocol !== "http:" ||
  process.env.CI
)
  throw new Error(
    "Development media acceptance is restricted to the local demo.",
  );
export default defineConfig({
  testDir: "./tests/development",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: origin,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : { channel: "chrome" }),
    },
    screenshot: "only-on-failure",
  },
});
