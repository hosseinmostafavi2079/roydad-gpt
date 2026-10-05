import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  sendTenantInvitationEmail,
  sendTenantEmailOtp,
  sendTenantVerificationEmail,
  sendTenantPasswordResetEmail,
  sendPasswordResetEmail,
  emailServiceAvailable,
} from "@/infrastructure/auth/mailer";
import { resetServerConfigForTests } from "@/shared/config/env";

const keys = [
  "NODE_ENV",
  "CONTROL_DATABASE_URL",
  "CONTROL_MIGRATION_DATABASE_URL",
  "CONTROL_QUEUE_DATABASE_URL",
  "TENANT_PROVISIONING_DATABASE_URL",
  "TENANT_RUNTIME_DATABASE_URL",
  "TENANT_MIGRATION_DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "TENANT_BOOTSTRAP_ENCRYPTION_KEY",
  "PLATFORM_BASE_DOMAIN",
  "SMTP_URL",
  "MAIL_TRANSPORT",
  "EVENTOS_TEST_MAIL_OUTBOX",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const outboxPath = path.join(
  os.tmpdir(),
  `eventos-mailer-unit-${randomUUID()}.jsonl`,
);
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(async () => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  resetServerConfigForTests();
  await unlink(outboxPath).catch(() => undefined);
});

function configureMailTest(
  nodeEnv: "test" | "development" | "production",
  mailTransport: "disabled" | "smtp" | "test",
): void {
  mutableEnv.NODE_ENV = nodeEnv;
  mutableEnv.MAIL_TRANSPORT = mailTransport;
  for (const name of [
    "CONTROL_DATABASE_URL",
    "CONTROL_MIGRATION_DATABASE_URL",
    "CONTROL_QUEUE_DATABASE_URL",
    "TENANT_PROVISIONING_DATABASE_URL",
    "TENANT_RUNTIME_DATABASE_URL",
    "TENANT_MIGRATION_DATABASE_URL",
  ]) {
    process.env[name] = "postgresql://test:local@127.0.0.1:55432/eventos_test";
  }
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "a".repeat(48);
  process.env.PLATFORM_BASE_DOMAIN = "localhost";
  process.env.SMTP_URL = "";
  process.env.TENANT_BOOTSTRAP_ENCRYPTION_KEY = "a".repeat(32);
  process.env.EVENTOS_TEST_MAIL_OUTBOX = outboxPath;
  resetServerConfigForTests();
}

describe("tenant invitation mail providers", () => {
  it("uses the explicit test provider for tenant and platform password recovery", async () => {
    configureMailTest("test", "test");
    await sendPasswordResetEmail({
      email: "platform@example.test",
      resetUrl: "https://example.test/reset",
    });
    await sendTenantPasswordResetEmail({
      email: "tenant@example.test",
      resetUrl: "https://tenant.example.test/reset",
    });
    const messages = (await readFile(outboxPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(messages.map((message) => message.email)).toEqual([
      "platform@example.test",
      "tenant@example.test",
    ]);
  });
  it("disabled production mail rejects every sender and creates no delivery record", async () => {
    configureMailTest("production", "disabled");
    expect(emailServiceAvailable()).toBe(false);
    for (const send of [
      () =>
        sendTenantInvitationEmail({
          email: "test@example.test",
          tenantName: "Test",
          inviteUrl: "https://example.test/invite",
        }),
      () =>
        sendTenantEmailOtp({
          email: "test@example.test",
          tenantName: "Test",
          otp: "123456",
        }),
      () =>
        sendTenantVerificationEmail({
          email: "test@example.test",
          tenantName: "Test",
          url: "https://example.test/verify",
        }),
      () =>
        sendTenantPasswordResetEmail({
          email: "test@example.test",
          resetUrl: "https://example.test/reset",
        }),
      () =>
        sendPasswordResetEmail({
          email: "test@example.test",
          resetUrl: "https://example.test/reset",
        }),
    ])
      await expect(send()).rejects.toThrow("سرویس ایمیل در دسترس نیست");
    await expect(readFile(outboxPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("captures the recipient and invitation with explicit test transport without SMTP", async () => {
    configureMailTest("development", "test");
    const input = {
      email: "recipient@example.test",
      tenantName: "Test Organization",
      inviteUrl:
        "http://tenant.localhost:3000/accept-invitation?token=test-token",
    };
    await sendTenantInvitationEmail(input);
    const messages = (await readFile(outboxPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(messages).toEqual([
      expect.objectContaining({
        ...input,
        subject: "Activate your Test Organization EventOS account",
        text: expect.stringContaining(input.inviteUrl),
        html: expect.stringContaining("Activate your account"),
      }),
    ]);
  });

  it("requires configured SMTP even when NODE_ENV is test", async () => {
    configureMailTest("test", "smtp");
    await expect(
      sendTenantInvitationEmail({
        email: "recipient@example.test",
        tenantName: "Test Organization",
        inviteUrl: "http://localhost:3000/accept-invitation?token=test-token",
      }),
    ).rejects.toThrow("سرویس ایمیل در دسترس نیست");
  });

  it("rejects test transport in an ordinary production process", async () => {
    configureMailTest("production", "test");
    await expect(
      sendTenantInvitationEmail({
        email: "recipient@example.test",
        tenantName: "Test Organization",
        inviteUrl: "http://localhost:3000/accept-invitation?token=test-token",
      }),
    ).rejects.toThrow(/Test mail transport is unavailable in production/);
  });

  it("fails safely without a production SMTP provider", async () => {
    configureMailTest("production", "smtp");
    await expect(
      sendTenantInvitationEmail({
        email: "recipient@example.test",
        tenantName: "Test Organization",
        inviteUrl: "http://localhost:3000/accept-invitation?token=test-token",
      }),
    ).rejects.toThrow(
      /Production password recovery requires configured SMTP delivery/,
    );
  });
});
