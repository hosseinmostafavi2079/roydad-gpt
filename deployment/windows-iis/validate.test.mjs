import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateWindowsIisEnvironment } from "../../scripts/windows-iis-preflight.mjs";

function fixture() {
  const env = {
    NODE_ENV: "production",
    MAIL_TRANSPORT: "smtp",
    SMS_TRANSPORT: "provider",
    MEDIA_S3_ALLOW_HTTP_LOCAL: "false",
    PLATFORM_REQUIRE_MFA: "false",
    TRUSTED_PROXY_CIDRS: "",
    BETTER_AUTH_URL: "https://event.mediasanat.ir",
    PLATFORM_BASE_DOMAIN: "mediasanat.ir",
    EVENTOS_IMAGE: `registry.example.test/eventos@sha256:${"a".repeat(64)}`,
    SMTP_URL: "smtps://synthetic:synthetic@smtp.example.test:465",
    SMTP_FROM: "Test <test@example.test>",
    MEDIA_S3_ENDPOINT: "https://storage.example.test",
    MEDIA_S3_REGION: "us-east-1",
    MEDIA_S3_BUCKET: "test-media",
    MEDIA_S3_ACCESS_KEY_ID: "synthetic-test-access",
    MEDIA_S3_SECRET_ACCESS_KEY: randomBytes(32).toString("hex"),
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GOOGLE_OAUTH_ALLOWED_ORIGINS: "",
  };
  for (const key of [
    "BETTER_AUTH_SECRET",
    "TENANT_BOOTSTRAP_ENCRYPTION_KEY",
    "POSTGRES_SUPERUSER_PASSWORD",
  ])
    env[key] = randomBytes(32).toString("hex");
  for (const [prefix, role, database] of [
    ["CONTROL", "eventos_control_app", "eventos_control"],
    ["CONTROL_MIGRATION", "eventos_control_migrator", "eventos_control"],
    ["CONTROL_QUEUE", "eventos_control_queue", "eventos_control"],
    ["TENANT_PROVISIONING", "eventos_tenant_provisioner", "postgres"],
    ["TENANT_RUNTIME", "eventos_tenant_runtime", "postgres"],
    ["TENANT_MIGRATION", "eventos_tenant_migrator", "postgres"],
  ]) {
    const passwordKey =
      {
        CONTROL: "CONTROL_APP_PASSWORD",
        TENANT_PROVISIONING: "TENANT_PROVISIONER_PASSWORD",
      }[prefix] ?? `${prefix}_PASSWORD`;
    env[passwordKey] = randomBytes(32).toString("hex");
    env[`${prefix}_DATABASE_URL`] =
      `postgresql://${role}:${env[passwordKey]}@postgres:5432/${database}`;
  }
  return env;
}
test("IIS production env accepts private role-separated configuration", () =>
  assert.deepEqual(validateWindowsIisEnvironment(fixture()), []));
test("production rejects test transports and bypass flags", () => {
  for (const key of [
    "SMS_TRANSPORT",
    "MAIL_TRANSPORT",
    "EVENTOS_E2E_GOOGLE_MOCK",
    "EVENTOS_TEST_MAIL_OUTBOX",
  ]) {
    const env = fixture();
    env[key] = key.endsWith("TRANSPORT") ? "test" : "true";
    assert.ok(
      validateWindowsIisEnvironment(env).some((error) => error.includes(key)),
    );
  }
});
test("missing SMTP and S3 fail without reporting values", () => {
  const env = fixture();
  env.SMTP_URL = "";
  env.MEDIA_S3_ENDPOINT = "";
  const errors = validateWindowsIisEnvironment(env);
  assert.ok(errors.some((error) => error.includes("SMTP_URL")));
  assert.ok(errors.some((error) => error.includes("MEDIA_S3_ENDPOINT")));
  assert.ok(!JSON.stringify(errors).includes(env.BETTER_AUTH_SECRET));
});
test("public DB and role/password mismatch rejected", () => {
  const env = fixture();
  env.CONTROL_DATABASE_URL = env.CONTROL_DATABASE_URL.replace(
    "@postgres:",
    "@127.0.0.1:",
  );
  assert.ok(
    validateWindowsIisEnvironment(env).some((error) =>
      error.includes("CONTROL_DATABASE_URL"),
    ),
  );
  const mismatch = fixture();
  mismatch.CONTROL_APP_PASSWORD = randomBytes(32).toString("hex");
  assert.ok(
    validateWindowsIisEnvironment(mismatch).some((error) =>
      error.includes("CONTROL_DATABASE_URL"),
    ),
  );
});
test("runtime-only validation preserves SMTP/SMS production guards", () => {
  const env = fixture();
  for (const key of Object.keys(env).filter((key) => key.endsWith("_PASSWORD")))
    delete env[key];
  assert.deepEqual(validateWindowsIisEnvironment(env, true), []);
  env.SMS_TRANSPORT = "test";
  assert.ok(validateWindowsIisEnvironment(env, true).length);
});
test("example intentionally cannot be used as production", () => {
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [
        "scripts/windows-iis-preflight.mjs",
        "--env-file",
        "deployment/windows-iis/.env.production.example",
      ],
      { stdio: "pipe" },
    ),
  );
});
test("Docker Compose config has only isolated EventOS resources and loopback app port", () => {
  // config is client-side only: no pull/start/daemon access and synthetic test data.
  const env = { ...process.env, ...fixture() };
  for (const key of Object.keys(env))
    if (/^EVENTOS_(E2E|TEST)_/.test(key)) delete env[key];
  let config;
  try {
    config = JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          "eventos-production",
          "-f",
          "deployment/windows-iis/compose.production.yaml",
          "config",
          "--format",
          "json",
        ],
        { env, stdio: "pipe", encoding: "utf8" },
      ),
    );
  } catch {
    throw new Error("Docker Compose config failed; no secrets printed");
  }
  assert.equal(config.name, "eventos-production");
  assert.deepEqual(Object.keys(config.services).sort(), [
    "app",
    "postgres",
    "worker",
  ]);
  const port = config.services.app.ports[0];
  assert.equal(config.services.app.ports.length, 1);
  assert.equal(port.host_ip, "127.0.0.1");
  assert.equal(String(port.published), "18280");
  assert.equal(port.target, 3000);
  for (const service of Object.values(config.services)) {
    assert.equal(service.container_name, undefined);
    assert.equal(service.build, undefined);
  }
  for (const key of ["postgres", "worker"])
    assert.equal(config.services[key].ports, undefined);
  for (const resource of [
    ...Object.values(config.volumes),
    ...Object.values(config.networks),
  ]) {
    assert.ok(resource.name.startsWith("eventos-production_"));
    assert.ok(!resource.external);
  }
  assert.equal(config.networks.database.internal, true);
  assert.equal(config.services.app.environment.SMS_TRANSPORT, "provider");
  assert.ok(
    config.services.app.command.join(" ").includes("windows-iis-preflight.mjs"),
  );
});
test("backup and lifecycle helpers contain no broad cleanup or non-EventOS mutations", () => {
  for (const file of [
    "backup.sh",
    "powershell/common.ps1",
    "powershell/backup.ps1",
    "powershell/prepare-release.ps1",
    "powershell/rollback.ps1",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(
      !/compose\s+down|system\s+prune|chmod\s+666|docker\s+stop/.test(source),
    );
  }
});

test("PowerShell isolation guard accepts only the exact EventOS topology (mocked WSL)", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "eventos-c1-"));
  const file = path.join(directory, "compose.json");
  const image = fixture().EVENTOS_IMAGE;
  const config = {
    name: "eventos-production",
    services: {
      app: {
        image,
        ports: [{ host_ip: "127.0.0.1", published: "18280", target: 3000 }],
      },
      postgres: { image: "postgres:18.6-alpine" },
      worker: { image },
    },
    networks: { database: { name: "eventos-production_database" } },
    volumes: { postgres: { name: "eventos-production_production-postgres" } },
  };
  const command =
    ". ./deployment/windows-iis/powershell/common.ps1; Initialize-Eventos Ubuntu /mnt/c/EventOS/release; function Invoke-EventosCompose { Get-Content -LiteralPath $env:EVENTOS_C1_CONFIG_TEST -Raw }; Assert-EventosCompose";
  const run = () =>
    execFileSync(
      "powershell.exe",
      // Local mocked test process only; no persistent execution-policy change.
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      { env: { ...process.env, EVENTOS_C1_CONFIG_TEST: file }, stdio: "pipe" },
    );
  try {
    writeFileSync(file, JSON.stringify(config));
    run();
    for (const port of ["18080", "18180", "3000"]) {
      config.services.app.ports[0].published = port;
      writeFileSync(file, JSON.stringify(config));
      assert.throws(run);
    }
    config.services.app.ports[0].published = "18280";
    config.services.app.ports[0].host_ip = "0.0.0.0";
    writeFileSync(file, JSON.stringify(config));
    assert.throws(run);
    config.services.app.ports[0].host_ip = "127.0.0.1";
    config.volumes.postgres.name = "pricepilot-production_postgres";
    writeFileSync(file, JSON.stringify(config));
    assert.throws(run);
  } finally {
    unlinkSync(file);
    rmdirSync(directory);
  }
});
