import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  invitationProviderKind,
  sendTenantInvitationEmail,
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
  "PLATFORM_BASE_DOMAIN",
  "SMTP_URL",
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

function configureMailTest(nodeEnv: "test" | "development"): void {
  mutableEnv.NODE_ENV = nodeEnv;
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
  process.env.EVENTOS_TEST_MAIL_OUTBOX = outboxPath;
  resetServerConfigForTests();
}

describe("tenant invitation mail providers", () => {
  it("captures the recipient and invitation in test mode without SMTP", async () => {
    configureMailTest("test");
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

  it("requires configured delivery outside test mode", async () => {
    configureMailTest("development");
    await expect(
      sendTenantInvitationEmail({
        email: "recipient@example.test",
        tenantName: "Test Organization",
        inviteUrl: "http://localhost:3000/accept-invitation?token=test-token",
      }),
    ).rejects.toThrow("Tenant invitation email delivery is not configured.");
  });

  it("does not select test delivery in an ordinary production process", () => {
    expect(invitationProviderKind("test", false)).toBe("test-outbox");
    expect(invitationProviderKind("development", false)).toBe("smtp");
    expect(invitationProviderKind("production", false)).toBe("smtp");
  });
});
