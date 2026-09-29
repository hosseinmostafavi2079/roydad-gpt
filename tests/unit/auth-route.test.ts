import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/infrastructure/auth/auth", () => ({
  getAuth: () => ({ handler: mocks.handler }),
}));

vi.mock("@/infrastructure/logging/logger", () => ({
  requestLogger: () => ({ error: mocks.logError }),
}));

import { POST } from "@/app/api/auth/[...all]/route";

describe("authentication route error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a generic error and logs no database details", async () => {
    mocks.handler.mockRejectedValueOnce(
      Object.assign(new Error("sensitive database row details"), {
        code: "23502",
        detail: "sensitive OTP and backup-code material",
      }),
    );
    const requestId = "c50d7ca1-3f91-4c20-b08d-65c36f7d67c2";

    const response = await POST(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "x-request-id": requestId, host: "localhost:3000" },
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(requestId);
    const body = await response.text();
    expect(body).toContain("Authentication could not be completed.");
    expect(body).not.toContain("sensitive");
    expect(mocks.logError).toHaveBeenCalledWith(
      { module: "auth", errorType: "Error" },
      "Authentication request failed unexpectedly",
    );
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(
      "sensitive",
    );
  });
});
