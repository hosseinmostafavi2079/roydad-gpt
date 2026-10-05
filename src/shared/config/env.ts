import "server-only";

import { z } from "zod";

const nonPlaceholder = (name: string) =>
  z
    .string()
    .min(1)
    .refine((value) => !value.toLowerCase().includes("replace-with"), {
      message: `${name} must be replaced with a real environment value`,
    });

const databaseUrl = (name: string) =>
  nonPlaceholder(name).refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        url.hostname.length > 0
      );
    } catch {
      return false;
    }
  }, `${name} must be a PostgreSQL URL`);

const serverConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    CONTROL_DATABASE_URL: databaseUrl("CONTROL_DATABASE_URL"),
    CONTROL_MIGRATION_DATABASE_URL: databaseUrl(
      "CONTROL_MIGRATION_DATABASE_URL",
    ),
    CONTROL_QUEUE_DATABASE_URL: databaseUrl("CONTROL_QUEUE_DATABASE_URL"),
    TENANT_PROVISIONING_DATABASE_URL: databaseUrl(
      "TENANT_PROVISIONING_DATABASE_URL",
    ),
    TENANT_RUNTIME_DATABASE_URL: databaseUrl("TENANT_RUNTIME_DATABASE_URL"),
    TENANT_MIGRATION_DATABASE_URL: databaseUrl("TENANT_MIGRATION_DATABASE_URL"),
    BETTER_AUTH_URL: nonPlaceholder("BETTER_AUTH_URL").url(),
    BETTER_AUTH_SECRET: nonPlaceholder("BETTER_AUTH_SECRET").min(32),
    TENANT_BOOTSTRAP_ENCRYPTION_KEY: z.string().default(""),
    PLATFORM_BASE_DOMAIN: nonPlaceholder("PLATFORM_BASE_DOMAIN")
      .min(1)
      .max(253),
    PLATFORM_REQUIRE_MFA: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    TRUSTED_PROXY_CIDRS: z.string().default(""),
    SMTP_URL: z.string().optional().default(""),
    MAIL_TRANSPORT: z.enum(["smtp", "test"]).default("smtp"),
    SMS_TRANSPORT: z.enum(["provider", "test"]).default("provider"),
    MEDIA_S3_ENDPOINT: z.string().default(""),
    MEDIA_S3_REGION: z.string().default("us-east-1"),
    MEDIA_S3_BUCKET: z.string().default(""),
    MEDIA_S3_ACCESS_KEY_ID: z.string().default(""),
    MEDIA_S3_SECRET_ACCESS_KEY: z.string().default(""),
    MEDIA_S3_ALLOW_HTTP_LOCAL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_FROM: z
      .string()
      .min(3)
      .default("EventOS Security <security@example.invalid>"),
    TENANT_POOL_LIMIT: z.coerce.number().int().min(1).max(128).default(16),
    TENANT_POOL_CONNECTIONS_PER_DATABASE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(2),
    TENANT_POOL_IDLE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(300000)
      .default(30000),
    TENANT_POOL_ACQUIRE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30000)
      .default(5000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === "production" && config.SMS_TRANSPORT === "test") {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_TRANSPORT"],
        message: "Test SMS transport is unavailable in production",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      config.MAIL_TRANSPORT === "test" &&
      !isE2eTestServer()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_TRANSPORT"],
        message: "Test mail transport is unavailable in production",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      (!config.SMTP_URL || !config.SMTP_FROM)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_URL"],
        message:
          "Production password recovery requires configured SMTP delivery",
      });
    }

    if (
      config.NODE_ENV === "production" &&
      config.TENANT_BOOTSTRAP_ENCRYPTION_KEY.length < 32
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["TENANT_BOOTSTRAP_ENCRYPTION_KEY"],
        message:
          "Production tenant bootstrap encryption needs a dedicated 32-character secret",
      });
    }

    if (
      config.SMTP_URL &&
      !config.SMTP_URL.toLowerCase().startsWith("smtps://") &&
      config.NODE_ENV === "production"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_URL"],
        message: "Production SMTP must use TLS (smtps://)",
      });
    }
  });

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function isE2eTestServer(): boolean {
  return (
    (globalThis as Record<symbol, unknown>)[
      Symbol.for("eventos.e2e.mail.outbox")
    ] === true &&
    process.env.EVENTOS_E2E_SERVER_PID_FILE === "tests/.e2e-server.json"
  );
}

export function parseServerConfig(
  env: Record<string, string | undefined>,
): ServerConfig {
  const parsed = serverConfigSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }

  return {
    ...parsed.data,
    PLATFORM_BASE_DOMAIN:
      parsed.data.PLATFORM_BASE_DOMAIN.toLowerCase().replace(/\.$/, ""),
  };
}

let cachedConfig: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  cachedConfig ??= parseServerConfig(process.env);
  return cachedConfig;
}

export function resetServerConfigForTests(): void {
  cachedConfig = undefined;
}
