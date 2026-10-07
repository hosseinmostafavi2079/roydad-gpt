import { describe, expect, it } from "vitest";
import {
  backupPolicySchema,
  backupScopeSchema,
  backupStateSchema,
  backupTriggerSchema,
} from "@/modules/platform/backups/schema";

const daily = {
  enabled: false,
  scope: "FULL_PLATFORM",
  frequency: "DAILY",
  executionTime: "02:30",
  timezone: "Asia/Tehran",
  retentionCount: 10,
};
describe("backup policy foundation", () => {
  it("accepts daily and weekly policy", () => {
    expect(backupPolicySchema.safeParse(daily).success).toBe(true);
    expect(
      backupPolicySchema.safeParse({
        ...daily,
        frequency: "WEEKLY",
        weekday: 6,
      }).success,
    ).toBe(true);
  });
  it.each([
    { frequency: "WEEKLY" },
    { weekday: 0 },
    { weekday: 7, frequency: "WEEKLY" },
    { retentionCount: 0 },
    { retentionCount: 101 },
    { frequency: "MONTHLY" },
    { executionTime: "24:00" },
    { timezone: "unknown-zone" },
    { unexpected: true },
    { scope: "TENANT" },
  ])("rejects invalid policy %j", (change) => {
    expect(backupPolicySchema.safeParse({ ...daily, ...change }).success).toBe(
      false,
    );
  });
  it("restricts scope, trigger and state enums", () => {
    expect(backupScopeSchema.parse("TENANT")).toBe("TENANT");
    expect(backupTriggerSchema.parse("MANUAL")).toBe("MANUAL");
    expect(backupStateSchema.parse("VERIFYING")).toBe("VERIFYING");
    for (const schema of [
      backupScopeSchema,
      backupTriggerSchema,
      backupStateSchema,
    ])
      expect(schema.safeParse("INVALID").success).toBe(false);
  });
});
