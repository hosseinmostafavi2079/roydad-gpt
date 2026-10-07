import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  check: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/infrastructure/db/control/pool", () => ({
  closeControlPool: mocks.close,
}));
vi.mock("@/modules/platform/backups/repository", () => ({
  BackupRepository: class {
    claimDeletion = mocks.claim;
    checkDeletion = mocks.check;
    completeDeletion = mocks.complete;
    failDeletion = mocks.fail;
  },
}));
vi.mock("@/modules/platform/diagnostics/service", () => ({
  upsertComponentHeartbeat: vi.fn(),
}));
const originalArgs = process.argv,
  originalExit = process.exitCode;
let output: string;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  output = "";
  process.exitCode = undefined;
  vi.spyOn(process.stdout, "write").mockImplementation((value) => {
    output += String(value);
    return true;
  });
  mocks.claim.mockResolvedValue(null);
  for (const mock of [mocks.check, mocks.complete, mocks.fail])
    mock.mockResolvedValue({ state: "SAFE" });
});
afterEach(() => {
  process.argv = originalArgs;
  process.exitCode = originalExit;
  vi.restoreAllMocks();
});
async function run(...args: string[]) {
  process.argv = ["node", "backup-job-control.ts", ...args];
  await import("../../scripts/backup-job-control");
  return JSON.parse(output);
}
it("claims manual deletion using machine-readable JSON and closes the pool", async () => {
  expect(await run("claim-delete")).toEqual({ data: null });
  expect(mocks.claim).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it.each(["check-delete", "complete-delete", "fail-delete"])(
  "dispatches trusted %s with validated UUID and key",
  async (command) => {
    const id = randomUUID(),
      key = `eventos-20260101T000000Z-${randomUUID()}`;
    expect(await run(command, id, key)).toEqual({ data: { state: "SAFE" } });
    const handler =
      command === "check-delete"
        ? mocks.check
        : command === "complete-delete"
          ? mocks.complete
          : mocks.fail;
    expect(handler).toHaveBeenCalledWith(id, key);
    expect(mocks.close).toHaveBeenCalledOnce();
  },
);
it.each([
  ["claim-delete", "unexpected"],
  ["check-delete", "invalid", "safe"],
  ["complete-delete", "11111111-1111-4111-8111-111111111111", "../escape"],
  ["fail-delete", "11111111-1111-4111-8111-111111111111", "/absolute"],
  ["check-delete", "11111111-1111-4111-8111-111111111111", "safe", "extra"],
])("fails closed for invalid arguments %j", async (...args) => {
  expect(await run(...args)).toEqual({ error: "BACKUP_CONTROL_FAILED" });
  expect(process.exitCode).toBe(1);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.fail).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
it("never writes raw deletion errors to JSON stdout", async () => {
  mocks.claim.mockRejectedValue(new Error("secret /host/path"));
  expect(await run("claim-delete")).toEqual({ error: "BACKUP_CONTROL_FAILED" });
  expect(output).not.toContain("secret");
});
