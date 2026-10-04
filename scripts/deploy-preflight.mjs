import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const runtimeOnly = process.argv.includes("--runtime-only");
const checkDb = process.argv.includes("--check-db");
const envPath = process.env.EVENTOS_PRODUCTION_ENV_FILE || ".env.production";
let config;
try {
  config = runtimeOnly ? process.env : parseEnv(readFileSync(envPath, "utf8"));
} catch {
  console.error(
    "Preflight: production environment file is missing or unreadable.",
  );
  process.exit(1);
}
const problems = [];
const fail = (name, reason) => problems.push(`${name}: ${reason}`);
const get = (name) => String(config[name] ?? "").trim();
const required = (name, min = 1) => {
  const value = get(name);
  if (
    value.length < min ||
    /replace-with|example\.invalid/i.test(value) ||
    /^(?:password|access-key|secret-key)$/i.test(value) ||
    (min >= 32 && /^(.)\1+$/.test(value))
  )
    fail(name, "a real value is required");
  return value;
};
const hostname = (value) =>
  /^(?=.{4,253}$)[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/.test(
    value,
  ) &&
  !value.endsWith(".localhost") &&
  !/(?:^|\.)example\.(?:com|net|org)$/.test(value) &&
  !value.includes("..") &&
  !value.includes("--.");

if (get("NODE_ENV") !== "production") fail("NODE_ENV", "must be production");
if (get("MAIL_TRANSPORT") !== "smtp") fail("MAIL_TRANSPORT", "must be smtp");
if (get("MEDIA_S3_ALLOW_HTTP_LOCAL") !== "false")
  fail("MEDIA_S3_ALLOW_HTTP_LOCAL", "must be false");
for (const name of Object.keys(config)) {
  if (
    (name.startsWith("EVENTOS_E2E_") || name.startsWith("EVENTOS_TEST_")) &&
    get(name)
  )
    fail(name, "test mode is unavailable in production");
}
const baseDomain = required("PLATFORM_BASE_DOMAIN");
if (!hostname(baseDomain))
  fail("PLATFORM_BASE_DOMAIN", "must be a public DNS name");
const platformUrl = required("BETTER_AUTH_URL");
let platformHost = "";
try {
  const url = new URL(platformUrl);
  platformHost = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !hostname(platformHost) ||
    !platformHost.endsWith(`.${baseDomain}`)
  )
    throw new Error("invalid");
} catch {
  fail(
    "BETTER_AUTH_URL",
    "must be an HTTPS platform subdomain without path or port",
  );
}
const publicHosts = get("PUBLIC_HOSTS")
  .split(/[\s,]+/)
  .filter(Boolean);
if (
  !publicHosts.length ||
  new Set(publicHosts).size !== publicHosts.length ||
  publicHosts.some(
    (host) =>
      !hostname(host) ||
      !host.endsWith(`.${baseDomain}`) ||
      host.slice(0, -(baseDomain.length + 1)).includes("."),
  ) ||
  !publicHosts.includes(platformHost)
)
  fail(
    "PUBLIC_HOSTS",
    "must list exact unique hostnames including the platform host",
  );
const pilotHost = required("PILOT_TENANT_HOST");
if (
  !publicHosts.includes(pilotHost) ||
  pilotHost === platformHost ||
  !pilotHost.endsWith(`.${baseDomain}`)
)
  fail("PILOT_TENANT_HOST", "must be an exact listed tenant subdomain");
if (get("TRUSTED_PROXY_CIDRS"))
  fail(
    "TRUSTED_PROXY_CIDRS",
    "must remain empty for the direct Caddy topology",
  );
const acmeEmail = required("ACME_EMAIL");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acmeEmail))
  fail("ACME_EMAIL", "must be a valid contact email");

const secrets = [
  "POSTGRES_SUPERUSER_PASSWORD",
  "CONTROL_APP_PASSWORD",
  "CONTROL_MIGRATION_PASSWORD",
  "CONTROL_QUEUE_PASSWORD",
  "TENANT_PROVISIONER_PASSWORD",
  "TENANT_RUNTIME_PASSWORD",
  "TENANT_MIGRATION_PASSWORD",
  "BETTER_AUTH_SECRET",
  "TENANT_BOOTSTRAP_ENCRYPTION_KEY",
];
for (const name of secrets.filter(
  (name) =>
    !runtimeOnly ||
    ["BETTER_AUTH_SECRET", "TENANT_BOOTSTRAP_ENCRYPTION_KEY"].includes(name),
))
  required(name, 32);
if (!runtimeOnly && new Set(secrets.map(get)).size !== secrets.length)
  fail("secrets", "each database and application secret must be unique");
const databaseUrls = {
  CONTROL_DATABASE_URL: ["eventos_control_app", "eventos_control"],
  CONTROL_MIGRATION_DATABASE_URL: [
    "eventos_control_migrator",
    "eventos_control",
  ],
  CONTROL_QUEUE_DATABASE_URL: ["eventos_control_queue", "eventos_control"],
  TENANT_PROVISIONING_DATABASE_URL: ["eventos_tenant_provisioner", "postgres"],
  TENANT_RUNTIME_DATABASE_URL: ["eventos_tenant_runtime", "postgres"],
  TENANT_MIGRATION_DATABASE_URL: ["eventos_tenant_migrator", "postgres"],
};
for (const [name, [role, database]] of Object.entries(databaseUrls)) {
  try {
    const url = new URL(required(name));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "postgres" ||
      url.port !== "5432" ||
      url.username !== role ||
      url.pathname !== `/${database}` ||
      !url.password ||
      /replace-with|^password$/i.test(url.password)
    )
      throw new Error("invalid");
  } catch {
    fail(name, "must use the expected role and private postgres:5432 database");
  }
}
try {
  const smtp = new URL(required("SMTP_URL"));
  if (
    smtp.protocol !== "smtps:" ||
    !hostname(smtp.hostname) ||
    !smtp.username ||
    !smtp.password ||
    /^(?:password|replace-with.*)$/i.test(smtp.password)
  )
    throw new Error("invalid");
} catch {
  fail("SMTP_URL", "must be a credentialed smtps:// URL");
}
if (!/^[^<>\r\n]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(required("SMTP_FROM")))
  fail("SMTP_FROM", "must include a public sender email");
try {
  const storage = new URL(required("MEDIA_S3_ENDPOINT"));
  if (
    storage.protocol !== "https:" ||
    !hostname(storage.hostname) ||
    storage.username ||
    storage.password ||
    storage.pathname !== "/"
  )
    throw new Error("invalid");
} catch {
  fail("MEDIA_S3_ENDPOINT", "must be a root HTTPS endpoint");
}
required("MEDIA_S3_REGION");
required("MEDIA_S3_BUCKET");
required("MEDIA_S3_ACCESS_KEY_ID", 12);
required("MEDIA_S3_SECRET_ACCESS_KEY", 32);
if (!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(get("MEDIA_S3_BUCKET")))
  fail("MEDIA_S3_BUCKET", "must be an S3 bucket name");
const google = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_ALLOWED_ORIGINS",
];
const googleConfigured = google.filter((name) => get(name));
if (googleConfigured.length && googleConfigured.length !== google.length)
  fail(
    "GOOGLE_OAUTH_ALLOWED_ORIGINS",
    "Google credentials and origins must be configured together",
  );
if (googleConfigured.length === google.length) {
  const origins = get("GOOGLE_OAUTH_ALLOWED_ORIGINS")
    .split(",")
    .map((item) => item.trim());
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.protocol !== "https:" ||
          url.port ||
          url.pathname !== "/" ||
          !publicHosts.includes(url.hostname) ||
          url.hostname === platformHost
        );
      } catch {
        return true;
      }
    })
  )
    fail(
      "GOOGLE_OAUTH_ALLOWED_ORIGINS",
      "must contain exact listed HTTPS tenant origins",
    );
}
if (
  get("PLATFORM_REQUIRE_MFA") &&
  !["true", "false"].includes(get("PLATFORM_REQUIRE_MFA"))
)
  fail("PLATFORM_REQUIRE_MFA", "must be true or false");
if (problems.length) {
  for (const problem of problems) console.error(`Preflight: ${problem}`);
  process.exit(1);
}
if (!runtimeOnly) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      envPath,
      "-f",
      "compose.production.yaml",
      "config",
      "--quiet",
    ],
    { stdio: "ignore" },
  );
  if (result.status !== 0) {
    console.error(
      "Preflight: production Compose configuration is invalid or Docker is unavailable.",
    );
    process.exit(1);
  }
}
if (checkDb) {
  const { Client } = await import("pg");
  for (const name of Object.keys(databaseUrls)) {
    const client = new Client({
      connectionString: get(name),
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
    } catch {
      fail(name, "database connection failed");
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  if (problems.length) {
    for (const problem of problems) console.error(`Preflight: ${problem}`);
    process.exit(1);
  }
}
console.log(
  "Production preflight passed (configuration only; no data changed).",
);
