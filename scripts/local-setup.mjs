import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  localMediaEnvironment,
  prepareDevelopmentMediaRoot,
} from "./local-media-env.mjs";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
if (process.env.NODE_ENV === "production" || process.env.CI)
  throw new Error("Local setup is disabled in production and CI.");
if (process.argv.slice(2).some((arg) => arg !== "--env-only"))
  throw new Error("Only --env-only is accepted.");
const secret = () => randomBytes(32).toString("base64url");
const envPath = path.join(root, ".env");

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}.`,
    );
}

function createEnv() {
  if (existsSync(envPath)) return;
  const passwords = Object.fromEntries(
    [
      "POSTGRES_SUPERUSER_PASSWORD",
      "CONTROL_APP_PASSWORD",
      "CONTROL_MIGRATION_PASSWORD",
      "CONTROL_QUEUE_PASSWORD",
      "TENANT_PROVISIONER_PASSWORD",
      "TENANT_RUNTIME_PASSWORD",
      "TENANT_MIGRATION_PASSWORD",
    ].map((key) => [key, secret()]),
  );
  const urls = {
    CONTROL_DATABASE_URL: [
      "eventos_control_app",
      "CONTROL_APP_PASSWORD",
      "eventos_control",
    ],
    CONTROL_MIGRATION_DATABASE_URL: [
      "eventos_control_migrator",
      "CONTROL_MIGRATION_PASSWORD",
      "eventos_control",
    ],
    CONTROL_QUEUE_DATABASE_URL: [
      "eventos_control_queue",
      "CONTROL_QUEUE_PASSWORD",
      "eventos_control",
    ],
    TENANT_PROVISIONING_DATABASE_URL: [
      "eventos_tenant_provisioner",
      "TENANT_PROVISIONER_PASSWORD",
      "postgres",
    ],
    TENANT_RUNTIME_DATABASE_URL: [
      "eventos_tenant_runtime",
      "TENANT_RUNTIME_PASSWORD",
      "postgres",
    ],
    TENANT_MIGRATION_DATABASE_URL: [
      "eventos_tenant_migrator",
      "TENANT_MIGRATION_PASSWORD",
      "postgres",
    ],
  };
  const values = {
    ...passwords,
    ...localMediaEnvironment(root),
    MAIL_TRANSPORT: "disabled",
    BETTER_AUTH_SECRET: secret(),
    TENANT_BOOTSTRAP_ENCRYPTION_KEY: secret(),
    PLATFORM_BOOTSTRAP_ADMIN_PASSWORD: secret(),
  };
  for (const [key, [user, passwordKey, database]] of Object.entries(urls))
    values[key] =
      `postgresql://${user}:${passwords[passwordKey]}@127.0.0.1:55432/${database}`;
  const template = readFileSync(path.join(root, ".env.example"), "utf8");
  const body = template.replace(/^([A-Z_]+)=.*$/gm, (line, key) =>
    key in values ? `${key}=${values[key]}` : line,
  );
  writeFileSync(
    envPath,
    `# DEVELOPMENT ONLY — generated local credentials; never copy to production.\n${body}`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created ignored .env with random local secrets.");
}

function createContainerEnv() {
  let existingEnv = readFileSync(envPath, "utf8");
  const fileConfig = parseEnv(existingEnv);
  if (
    fileConfig.NODE_ENV === "production" ||
    fileConfig.PLATFORM_BASE_DOMAIN !== "localhost"
  )
    throw new Error(
      "Existing .env is not an EventOS development configuration.",
    );
  for (const key of [
    "CONTROL_DATABASE_URL",
    "CONTROL_MIGRATION_DATABASE_URL",
    "CONTROL_QUEUE_DATABASE_URL",
    "TENANT_PROVISIONING_DATABASE_URL",
    "TENANT_RUNTIME_DATABASE_URL",
    "TENANT_MIGRATION_DATABASE_URL",
  ])
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(fileConfig[key] ?? "").hostname,
      )
    )
      throw new Error("Local setup requires loopback database configuration.");
  process.loadEnvFile(envPath);
  const driver = process.env.MEDIA_STORAGE_DRIVER || "local";
  const media = localMediaEnvironment(root, driver);
  if (driver === "local") prepareDevelopmentMediaRoot(root);
  for (const [key, value] of Object.entries(media)) {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (!pattern.test(existingEnv))
      existingEnv += `\n${key}=${JSON.stringify(value)}\n`;
  }
  if (readFileSync(envPath, "utf8") !== existingEnv)
    writeFileSync(envPath, existingEnv, { mode: 0o600 });
  if (!/^TENANT_BOOTSTRAP_ENCRYPTION_KEY=/m.test(existingEnv)) {
    writeFileSync(
      envPath,
      `${existingEnv.trimEnd()}\nTENANT_BOOTSTRAP_ENCRYPTION_KEY=${secret()}\n`,
      { mode: 0o600 },
    );
    console.log("Added a dedicated bootstrap encryption key to ignored .env.");
  }
  process.loadEnvFile(envPath);
  const databaseKeys = [
    "CONTROL_DATABASE_URL",
    "CONTROL_MIGRATION_DATABASE_URL",
    "CONTROL_QUEUE_DATABASE_URL",
    "TENANT_PROVISIONING_DATABASE_URL",
    "TENANT_RUNTIME_DATABASE_URL",
    "TENANT_MIGRATION_DATABASE_URL",
  ];
  const values = {};
  for (const key of databaseKeys) {
    const raw = process.env[key];
    if (!raw || raw.includes("replace-with"))
      throw new Error(`${key} must be configured in .env.`);
    const url = new URL(raw);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname))
      throw new Error("Local setup only accepts loopback PostgreSQL URLs.");
    url.hostname = "postgres";
    url.port = "5432";
    values[key] = url.toString();
  }
  for (const key of [
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "TENANT_BOOTSTRAP_ENCRYPTION_KEY",
    "PLATFORM_BASE_DOMAIN",
    "SMTP_FROM",
    "LOG_LEVEL",
    "TENANT_POOL_LIMIT",
    "TENANT_POOL_CONNECTIONS_PER_DATABASE",
    "TENANT_POOL_IDLE_TIMEOUT_MS",
    "TENANT_POOL_ACQUIRE_TIMEOUT_MS",
    "TRUSTED_PROXY_CIDRS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_ALLOWED_ORIGINS",
  ])
    values[key] = process.env[key] ?? "";
  if (
    values.BETTER_AUTH_URL !== "http://localhost:3000" ||
    values.PLATFORM_BASE_DOMAIN !== "localhost"
  )
    throw new Error("Local setup requires localhost URLs and platform domain.");
  for (const key of ["BETTER_AUTH_SECRET", "TENANT_BOOTSTRAP_ENCRYPTION_KEY"])
    if (
      !values[key] ||
      values[key].includes("replace-with") ||
      values[key].length < 32
    )
      throw new Error(
        `${key} must be a unique local secret of at least 32 characters.`,
      );
  values.SMTP_URL = process.env.SMTP_URL || "";
  values.NODE_ENV = "production";
  values.MAIL_TRANSPORT =
    process.env.MAIL_TRANSPORT || (values.SMTP_URL ? "smtp" : "disabled");
  if (values.MAIL_TRANSPORT === "test")
    throw new Error("Docker local runtime cannot use test mail transport.");
  Object.assign(values, localMediaEnvironment(root, driver, true));
  values.PLATFORM_REQUIRE_MFA =
    process.env.PLATFORM_REQUIRE_MFA === "true" ? "true" : "false";
  values.MEDIA_S3_ENDPOINT = driver === "s3" ? "http://storage:9090" : "";
  for (const key of [
    "MEDIA_S3_REGION",
    "MEDIA_S3_BUCKET",
    "MEDIA_S3_ACCESS_KEY_ID",
    "MEDIA_S3_SECRET_ACCESS_KEY",
    "MEDIA_S3_ALLOW_HTTP_LOCAL",
  ])
    values[key] = process.env[key] ?? "";
  const output = `${Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
  writeFileSync(path.join(root, ".env.local-runtime"), output, { mode: 0o600 });
  if (!process.env.SMTP_URL)
    console.log(
      "Email delivery is unavailable until an explicit SMTP provider is configured.",
    );
}

createEnv();
createContainerEnv();
if (process.argv.includes("--env-only")) process.exit(0);
run("docker", ["info", "--format", "{{.ServerVersion}}"]);
run("docker", [
  "compose",
  "up",
  "-d",
  "--wait",
  "postgres",
  ...(process.env.MEDIA_STORAGE_DRIVER === "s3" ? ["storage"] : []),
]);
const scriptEnv = {
  ...process.env,
  NODE_ENV: "development",
  MAIL_TRANSPORT:
    process.env.MAIL_TRANSPORT || (process.env.SMTP_URL ? "smtp" : "disabled"),
};
for (const script of [
  "db-migrate.ts",
  "migrate-tenant-databases.ts",
  "demo-setup.ts",
])
  run(
    process.execPath,
    ["--conditions=react-server", "--import=tsx", `scripts/${script}`],
    scriptEnv,
  );
run("docker", ["compose", "build", "app", "worker"]);
run("docker", ["compose", "up", "-d", "--wait", "app", "worker"]);
if (process.env.MEDIA_STORAGE_DRIVER === "local") {
  for (const args of [[], ["--apply"]])
    run(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "scripts/sync-development-media.ts",
        ...args,
      ],
      scriptEnv,
    );
}
console.log("EventOS is running in the background.");
console.log("Platform: http://localhost:3000/sign-in");
console.log("Tenant: http://demo.localhost:3000/login");
console.log("Demo logins: .demo-credentials.local (ignored by Git)");
console.log(
  process.env.PLATFORM_REQUIRE_MFA === "true"
    ? "Platform administrators must enroll TOTP on first login."
    : "Platform administrators can sign in with email and password.",
);
