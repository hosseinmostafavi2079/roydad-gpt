import { expect, it } from "vitest";
import { nextBackupRun } from "@/modules/platform/backups/schedule";
import type { BackupPolicy } from "@/modules/platform/backups/schema";

const daily: BackupPolicy = {
  enabled: true,
  scope: "FULL_PLATFORM",
  frequency: "DAILY",
  executionTime: "02:30",
  timezone: "UTC",
  retentionCount: 7,
};
it("daily UTC occurrence and exact slot advance to next local day", () => {
  expect(
    nextBackupRun(daily, new Date("2026-01-01T00:00:00Z")).toISOString(),
  ).toBe("2026-01-01T02:30:00.000Z");
  expect(
    nextBackupRun(daily, new Date("2026-01-01T02:30:00Z")).toISOString(),
  ).toBe("2026-01-02T02:30:00.000Z");
});
it("weekly timezone calculation uses configured local weekday", () => {
  expect(
    nextBackupRun(
      { ...daily, frequency: "WEEKLY", weekday: 1, timezone: "Asia/Tehran" },
      new Date("2026-01-04T00:00:00Z"),
    ).toISOString(),
  ).toBe("2026-01-04T23:00:00.000Z");
});
it("DST gap shifts to first available minute", () => {
  expect(
    nextBackupRun(
      { ...daily, timezone: "America/New_York" },
      new Date("2026-03-08T05:00:00Z"),
    ).toISOString(),
  ).toBe("2026-03-08T07:00:00.000Z");
});
it("DST overlap uses first occurrence and skips repeated same-day slot", () => {
  const policy = {
    ...daily,
    executionTime: "01:30",
    timezone: "America/New_York",
  };
  expect(
    nextBackupRun(policy, new Date("2026-11-01T04:00:00Z")).toISOString(),
  ).toBe("2026-11-01T05:30:00.000Z");
  expect(
    nextBackupRun(policy, new Date("2026-11-01T05:30:00Z")).toISOString(),
  ).toBe("2026-11-02T06:30:00.000Z");
});
