import { describe, expect, it } from "vitest";
import { parseServerConfig } from "@/shared/config/env";

const validConfig = {
  NODE_ENV: "test",
  CONTROL_DATABASE_URL:
    "postgresql://control_app:long-local-password@127.0.0.1:55432/eventos_control",
  CONTROL_MIGRATION_DATABASE_URL:
    "postgresql://control_migrator:long-local-password@127.0.0.1:55432/eventos_control",
  CONTROL_QUEUE_DATABASE_URL:
    "postgresql://control_queue:long-local-password@127.0.0.1:55432/eventos_control",
  TENANT_PROVISIONING_DATABASE_URL:
    "postgresql://tenant_provisioner:long-local-password@127.0.0.1:55432/postgres",
  TENANT_RUNTIME_DATABASE_URL:
    "postgresql://tenant_runtime:long-local-password@127.0.0.1:55432/postgres",
  TENANT_MIGRATION_DATABASE_URL:
    "postgresql://tenant_migrator:long-local-password@127.0.0.1:55432/postgres",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "a".repeat(48),
  PLATFORM_BASE_DOMAIN: "localhost",
};

describe("server configuration", () => {
  it("parses required URLs and defaults safely", () => {
    const parsed = parseServerConfig(validConfig);
    expect(parsed.PLATFORM_REQUIRE_MFA).toBe(false);
    expect(parsed.TENANT_POOL_LIMIT).toBe(16);
    expect(parsed.MAIL_TRANSPORT).toBe("smtp");
  });

  it("allows optional MFA in production and keeps secure mail delivery", () => {
    expect(
      parseServerConfig({
        ...validConfig,
        NODE_ENV: "production",
        PLATFORM_REQUIRE_MFA: "false",
        SMTP_URL: "smtps://mail.example.com",
        TENANT_BOOTSTRAP_ENCRYPTION_KEY: "a".repeat(32),
      }).PLATFORM_REQUIRE_MFA,
    ).toBe(false);
    expect(
      parseServerConfig({ ...validConfig, PLATFORM_REQUIRE_MFA: "true" })
        .PLATFORM_REQUIRE_MFA,
    ).toBe(true);
    expect(() =>
      parseServerConfig({ ...validConfig, NODE_ENV: "production" }),
    ).toThrow(/SMTP/);
    expect(() =>
      parseServerConfig({
        ...validConfig,
        NODE_ENV: "production",
        SMTP_URL: "smtp://mail.example.com",
      }),
    ).toThrow(/TLS/);
    expect(() =>
      parseServerConfig({
        ...validConfig,
        NODE_ENV: "production",
        SMTP_URL: "smtps://mail.example.com",
      }),
    ).toThrow(/dedicated 32-character secret/);
  });

  it("rejects empty and scaffold placeholder secrets", () => {
    expect(() =>
      parseServerConfig({
        ...validConfig,
        BETTER_AUTH_SECRET: "replace-with-secret",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    expect(() =>
      parseServerConfig({
        ...validConfig,
        TENANT_RUNTIME_DATABASE_URL: "replace-with-db-url",
      }),
    ).toThrow(/TENANT_RUNTIME_DATABASE_URL/);
  });

  it("rejects production test mail transport", () => {
    expect(() =>
      parseServerConfig({
        ...validConfig,
        NODE_ENV: "production",
        MAIL_TRANSPORT: "test",
        SMTP_URL: "smtps://mail.example.com",
        TENANT_BOOTSTRAP_ENCRYPTION_KEY: "a".repeat(32),
      }),
    ).toThrow(/Test mail transport is unavailable in production/);
  });
  it("rejects test SMS in production without any E2E exception", () => {
    expect(parseServerConfig(validConfig).SMS_TRANSPORT).toBe("provider");
    expect(() =>
      parseServerConfig({
        ...validConfig,
        NODE_ENV: "production",
        SMS_TRANSPORT: "test",
        SMTP_URL: "smtps://mail.example.com",
        TENANT_BOOTSTRAP_ENCRYPTION_KEY: "a".repeat(32),
      }),
    ).toThrow("Test SMS transport is unavailable in production");
    expect(
      parseServerConfig({ ...validConfig, SMS_TRANSPORT: "test" })
        .SMS_TRANSPORT,
    ).toBe("test");
  });
});
