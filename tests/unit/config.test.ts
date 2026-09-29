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
    expect(parsed.PLATFORM_REQUIRE_MFA).toBe(true);
    expect(parsed.TENANT_POOL_LIMIT).toBe(16);
  });

  it("rejects production without mandatory MFA and secure mail delivery", () => {
    expect(() =>
      parseServerConfig({
        ...validConfig,
        NODE_ENV: "production",
        PLATFORM_REQUIRE_MFA: "false",
      }),
    ).toThrow(/MFA cannot be disabled/);
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
});
