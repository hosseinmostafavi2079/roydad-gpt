import { afterEach, describe, expect, it } from "vitest";
import { workerDiagnostics } from "../helpers/worker-diagnostics";

const originalPassword = process.env.CONTROL_QUEUE_PASSWORD;

afterEach(() => {
  if (originalPassword === undefined) delete process.env.CONTROL_QUEUE_PASSWORD;
  else process.env.CONTROL_QUEUE_PASSWORD = originalPassword;
});

describe("provisioning worker diagnostics", () => {
  it("includes stderr and exit details while redacting database credentials", () => {
    process.env.CONTROL_QUEUE_PASSWORD = "test-diagnostic-password";
    const output = workerDiagnostics(
      "worker output",
      "connection failed for postgresql://queue:test-diagnostic-password@127.0.0.1:55432/eventos_control",
    );
    expect(output).toContain("connection failed");
    expect(output).toContain("worker output");
    expect(output).not.toContain("test-diagnostic-password");
    expect(output).toContain("[REDACTED]");
  });
});
