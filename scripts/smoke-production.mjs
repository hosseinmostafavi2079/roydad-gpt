import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const local = process.argv.includes("--local");
let config;
try {
  config = parseEnv(
    readFileSync(
      process.env.EVENTOS_PRODUCTION_ENV_FILE || ".env.production",
      "utf8",
    ),
  );
} catch {
  console.error("Smoke: production environment file is missing or unreadable.");
  process.exit(1);
}
const platform = local
  ? process.env.SMOKE_PLATFORM_URL
  : config.BETTER_AUTH_URL;
const tenant = local
  ? process.env.SMOKE_TENANT_URL
  : `https://${config.PILOT_TENANT_HOST}`;
if (
  !platform ||
  !tenant ||
  (!local &&
    (!platform.startsWith("https://") || !tenant.startsWith("https://")))
) {
  console.error("Smoke: valid HTTPS platform and tenant URLs are required.");
  process.exit(1);
}
if (
  local &&
  ![platform, tenant].every((value) => {
    try {
      return (
        ["localhost", "127.0.0.1"].includes(new URL(value).hostname) ||
        new URL(value).hostname.endsWith(".localhost")
      );
    } catch {
      return false;
    }
  })
) {
  console.error("Smoke: local mode only permits localhost URLs.");
  process.exit(1);
}
const timeout = 8_000;
async function check(label, url, expected = 200) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status !== expected) throw new Error("status");
    return response;
  } catch {
    throw new Error(`Smoke: ${label} failed.`);
  }
}
try {
  await check("platform liveness", new URL("/api/health/live", platform));
  const ready = await check(
    "platform readiness",
    new URL("/api/health/ready", platform),
  );
  if ((await ready.json())?.data?.status !== "ready")
    throw new Error("Smoke: readiness response failed.");
  const home = await check("tenant homepage", new URL("/", tenant));
  const html = await home.text();
  await check("tenant login", new URL("/login", tenant));
  await check("tenant robots", new URL("/robots.txt", tenant));
  const asset = html.match(/\/_next\/static\/[^"'<>\s]+/);
  if (!asset)
    throw new Error("Smoke: no static asset was found on the tenant homepage.");
  await check(
    "tenant static asset",
    new URL(asset[0].replaceAll("&amp;", "&"), tenant),
  );
  if (process.env.SMOKE_PUBLIC_MEDIA_PATH) {
    if (
      !/^\/api\/media\/[0-9a-f-]{36}$/i.test(
        process.env.SMOKE_PUBLIC_MEDIA_PATH,
      )
    )
      throw new Error("Smoke: public media path is invalid.");
    await check(
      "published public media",
      new URL(process.env.SMOKE_PUBLIC_MEDIA_PATH, tenant),
    );
  }
  console.log("Production smoke passed (read-only HTTP checks).");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Smoke: request failed.",
  );
  process.exitCode = 1;
}
