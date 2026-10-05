import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

// IIS topology only; do not reuse the Caddy-specific production preflight.
export function validateWindowsIisEnvironment(env, runtimeOnly = false) {
  const errors = [];
  const value = (key) => String(env[key] ?? "").trim();
  const requireValue = (key, length = 1) => {
    const text = value(key);
    if (
      text.length < length ||
      /replace-with|example\.invalid/i.test(text) ||
      (length >= 32 && /^(.)\1+$/.test(text))
    )
      errors.push(`${key}: real configuration required`);
    return text;
  };
  for (const [key, expected] of Object.entries({
    NODE_ENV: "production",
    MAIL_TRANSPORT: "smtp",
    SMS_TRANSPORT: "provider",
    MEDIA_S3_ALLOW_HTTP_LOCAL: "false",
  }))
    if (value(key) !== expected) errors.push(`${key}: must be ${expected}`);
  for (const key of Object.keys(env))
    if (/^EVENTOS_(E2E|TEST)_/.test(key) && value(key))
      errors.push(`${key}: test mode forbidden`);
  if (value("TRUSTED_PROXY_CIDRS"))
    errors.push(
      "TRUSTED_PROXY_CIDRS: must remain empty; Host is authoritative",
    );
  if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(requireValue("PLATFORM_BASE_DOMAIN"))
  )
    errors.push("PLATFORM_BASE_DOMAIN: public DNS namespace required");
  if (value("BETTER_AUTH_URL") !== "https://event.mediasanat.ir")
    errors.push("BETTER_AUTH_URL: expected https://event.mediasanat.ir");
  if (!["true", "false"].includes(value("PLATFORM_REQUIRE_MFA")))
    errors.push("PLATFORM_REQUIRE_MFA: true or false required");
  const secrets = ["BETTER_AUTH_SECRET", "TENANT_BOOTSTRAP_ENCRYPTION_KEY"];
  if (!runtimeOnly)
    secrets.push(
      "POSTGRES_SUPERUSER_PASSWORD",
      "CONTROL_APP_PASSWORD",
      "CONTROL_MIGRATION_PASSWORD",
      "CONTROL_QUEUE_PASSWORD",
      "TENANT_PROVISIONER_PASSWORD",
      "TENANT_RUNTIME_PASSWORD",
      "TENANT_MIGRATION_PASSWORD",
    );
  if (
    !runtimeOnly &&
    !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(value("EVENTOS_IMAGE"))
  )
    errors.push("EVENTOS_IMAGE: immutable registry digest required");
  for (const key of secrets) requireValue(key, 32);
  if (new Set(secrets.map(value)).size !== secrets.length)
    errors.push("secrets: unique independent secrets required");
  const roles = {
    CONTROL_DATABASE_URL: [
      "eventos_control_app",
      "eventos_control",
      "CONTROL_APP_PASSWORD",
    ],
    CONTROL_MIGRATION_DATABASE_URL: [
      "eventos_control_migrator",
      "eventos_control",
      "CONTROL_MIGRATION_PASSWORD",
    ],
    CONTROL_QUEUE_DATABASE_URL: [
      "eventos_control_queue",
      "eventos_control",
      "CONTROL_QUEUE_PASSWORD",
    ],
    TENANT_PROVISIONING_DATABASE_URL: [
      "eventos_tenant_provisioner",
      "postgres",
      "TENANT_PROVISIONER_PASSWORD",
    ],
    TENANT_RUNTIME_DATABASE_URL: [
      "eventos_tenant_runtime",
      "postgres",
      "TENANT_RUNTIME_PASSWORD",
    ],
    TENANT_MIGRATION_DATABASE_URL: [
      "eventos_tenant_migrator",
      "postgres",
      "TENANT_MIGRATION_PASSWORD",
    ],
  };
  for (const [key, [role, database, passwordKey]] of Object.entries(roles)) {
    try {
      const url = new URL(requireValue(key));
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== "postgres" ||
        url.port !== "5432" ||
        url.username !== role ||
        url.pathname !== `/${database}` ||
        !url.password ||
        (!runtimeOnly &&
          decodeURIComponent(url.password) !== value(passwordKey))
      )
        throw new Error();
    } catch {
      errors.push(`${key}: private role-separated PostgreSQL URL required`);
    }
  }
  // SMTP is mandatory in the current runtime, independently of tenant login settings.
  try {
    const url = new URL(requireValue("SMTP_URL"));
    if (url.protocol !== "smtps:" || !url.username || !url.password)
      throw new Error();
  } catch {
    errors.push(
      "SMTP_URL: real TLS SMTP required, even with email login disabled",
    );
  }
  if (!/^[^<>\r\n]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(requireValue("SMTP_FROM")))
    errors.push("SMTP_FROM: real sender required");
  try {
    const url = new URL(requireValue("MEDIA_S3_ENDPOINT"));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      ["localhost", "127.0.0.1", "postgres"].includes(url.hostname)
    )
      throw new Error();
  } catch {
    errors.push("MEDIA_S3_ENDPOINT: external HTTPS S3 endpoint required");
  }
  requireValue("MEDIA_S3_REGION");
  requireValue("MEDIA_S3_BUCKET");
  requireValue("MEDIA_S3_ACCESS_KEY_ID", 12);
  requireValue("MEDIA_S3_SECRET_ACCESS_KEY", 32);
  const google = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_ALLOWED_ORIGINS",
  ];
  if (google.some((key) => value(key)) && !google.every((key) => value(key)))
    errors.push(
      "Google: credentials and exact origins must be configured together",
    );
  if (value("GOOGLE_OAUTH_ALLOWED_ORIGINS"))
    for (const origin of value("GOOGLE_OAUTH_ALLOWED_ORIGINS").split(",")) {
      try {
        const url = new URL(origin.trim());
        if (
          url.protocol !== "https:" ||
          url.origin !== origin.trim() ||
          url.hostname === "event.mediasanat.ir"
        )
          throw new Error();
      } catch {
        errors.push("Google: exact tenant HTTPS origins required");
      }
    }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const runtimeOnly = process.argv.includes("--runtime-only");
  let env;
  try {
    env = runtimeOnly
      ? process.env
      : parseEnv(
          readFileSync(
            process.argv[process.argv.indexOf("--env-file") + 1],
            "utf8",
          ),
        );
  } catch {
    console.error("IIS preflight: env file missing or unreadable");
    process.exit(1);
  }
  const errors = validateWindowsIisEnvironment(env, runtimeOnly);
  for (const error of errors) console.error(`IIS preflight: ${error}`);
  if (errors.length) process.exit(1);
  console.log("IIS production environment valid (no secret values printed).");
}
