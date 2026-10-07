import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("@/infrastructure/db/control/pool", () => ({
  closeControlPool: mocks.close,
}));
vi.mock("@/modules/platform/diagnostics/service", () => ({
  upsertComponentHeartbeat: async (_component: string, warn: () => void) =>
    warn(),
}));
vi.mock("@/modules/platform/backups/repository", () => ({
  BackupRepository: class {
    constructor(
      _pool: unknown,
      private warn: () => void,
    ) {}
    async claim() {
      this.warn();
      return null;
    }
  },
}));
it("diagnostic warnings cannot contaminate backup job-control stdout JSON", async () => {
  const previous = process.argv;
  const stdout: string[] = [],
    stderr: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((value) => {
    stdout.push(String(value));
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((value) => {
    stderr.push(String(value));
    return true;
  });
  try {
    process.argv = ["node", "scripts/backup-job-control.ts", "claim"];
    await import("../../scripts/backup-job-control");
    expect(stdout.join("")).toBe('{"data":null}\n');
    expect(stderr).toHaveLength(2);
    expect(stderr.join("")).toContain("Diagnostic recording unavailable.");
    expect(mocks.close).toHaveBeenCalledOnce();
  } finally {
    process.argv = previous;
    out.mockRestore();
    err.mockRestore();
  }
});
