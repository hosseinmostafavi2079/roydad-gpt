import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { heartbeatHealth } from "@/modules/platform/diagnostics/repository";
import {
  eventInputSchema,
  eventListSchema,
  incidentListSchema,
  sanitizeMetadata,
} from "@/modules/platform/diagnostics/schema";
import {
  recordOperationalFailure,
  recordOperationalRecovery,
  upsertComponentHeartbeat,
} from "@/modules/platform/diagnostics/service";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), warn: vi.fn() }));
vi.mock("@/infrastructure/db/control/pool", () => ({
  getControlPool: () => ({ connect: mocks.connect }),
}));
vi.mock("@/infrastructure/logging/logger", () => ({
  logger: { warn: mocks.warn },
}));

it.each([
  "password",
  "token",
  "authorization",
  "cookie",
  "apiKey",
  "connectionString",
  "databaseUrl",
  "smtpUrl",
  "otp",
  "backupCodes",
  "privateKey",
  "accessToken",
  "refreshToken",
  "idToken",
  "stack",
  "requestBody",
])("rejects sensitive metadata %s", (key) => {
  expect(() => sanitizeMetadata({ [key]: "sensitive" })).toThrow();
});
it.each([
  { nested: { token: "secret" } },
  { phase: "x".repeat(10000) },
  new Error("secret"),
  new Request("http://localhost"),
  [],
  { attempt: 1001 },
  Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), i])),
])("rejects unbounded or non-domain metadata", (value) => {
  expect(() => sanitizeMetadata(value)).toThrow();
});
it("accepts only safe enums and bounded counters", () => {
  expect(
    sanitizeMetadata({
      scope: "TENANT",
      phase: "VERIFYING",
      errorCode: "BACKUP_FAILED",
      attempt: 2,
      retryable: true,
    }),
  ).toEqual({
    scope: "TENANT",
    phase: "VERIFYING",
    errorCode: "BACKUP_FAILED",
    attempt: 2,
    retryable: true,
  });
  expect(sanitizeMetadata(undefined)).toEqual({});
});
it.each([
  { limit: 101 },
  { limit: 0 },
  { offset: 10001 },
  { severity: "HIGH" },
  { status: "CLOSED" },
  { component: "sql;DROP" },
  { tenantId: "other" },
  { requestId: "secret" },
  { incidentRef: "../../etc" },
  { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" },
  { from: "2026-03-01T00:00:00Z", to: "2026-01-01T00:00:00Z" },
  { rawSql: "SELECT" },
])("strictly rejects invalid filters", (input) =>
  expect(incidentListSchema.safeParse(input).success).toBe(false),
);
it("validates event filters and rejects normal business errors as diagnostic codes", () => {
  expect(eventListSchema.parse({ component: "SMS" }).limit).toBe(25);
  for (const code of [
    "INVALID_PASSWORD",
    "NOT_FOUND",
    "VALIDATION_FAILED",
    "CANCELLED",
  ])
    expect(eventInputSchema.safeParse({ code }).success).toBe(false);
});
it("uses distinct measured worker and backup runner heartbeat ages", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000);
  expect(heartbeatHealth("MAIN_WORKER", ago(1), "HEALTHY", now)).toBe(
    "HEALTHY",
  );
  expect(heartbeatHealth("MAIN_WORKER", ago(3), "HEALTHY", now)).toBe(
    "DEGRADED",
  );
  expect(heartbeatHealth("MAIN_WORKER", ago(6), "HEALTHY", now)).toBe(
    "UNAVAILABLE",
  );
  expect(heartbeatHealth("BACKUP_RUNNER", null, "HEALTHY", now)).toBe(
    "UNKNOWN",
  );
  expect(heartbeatHealth("BACKUP_RUNNER", ago(20), "HEALTHY", now)).toBe(
    "HEALTHY",
  );
  expect(heartbeatHealth("BACKUP_RUNNER", ago(40), "HEALTHY", now)).toBe(
    "DEGRADED",
  );
  expect(heartbeatHealth("BACKUP_RUNNER", ago(61), "HEALTHY", now)).toBe(
    "UNAVAILABLE",
  );
});
it("failed diagnostics never break business callers or expose the failure contents", async () => {
  mocks.connect.mockRejectedValue(new Error("password=secret"));
  await expect(
    recordOperationalFailure({ code: "BACKUP_FAILED" }),
  ).resolves.toBeUndefined();
  await expect(
    recordOperationalRecovery({ code: "BACKUP_FAILED" }),
  ).resolves.toBeUndefined();
  await expect(
    upsertComponentHeartbeat("MAIN_WORKER"),
  ).resolves.toBeUndefined();
  expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("password");
});
it("instruments only reviewed host/worker boundaries without UI/socket/log APIs", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const worker = read("scripts/provisioning-worker.ts");
  expect(worker).toContain("code:");
  expect(worker).toContain("TENANT_PROVISIONING_FAILED");
  expect(worker).toContain("60_000");
  expect(worker).toContain("clearInterval(heartbeatTimer)");
  expect(read("scripts/backup-job-control.ts")).toContain(
    'upsertComponentHeartbeat("BACKUP_RUNNER", diagnosticWarning)',
  );
  expect(read("src/app/api/health/ready/route.ts")).toContain(
    "CONTROL_DB_UNAVAILABLE",
  );
  expect(read("src/app/api/health/ready/route.ts")).not.toContain(
    "recordOperationalFailure",
  );
  expect(read("src/shared/http/api-response.ts")).not.toContain(
    "recordOperationalFailure",
  );
});
