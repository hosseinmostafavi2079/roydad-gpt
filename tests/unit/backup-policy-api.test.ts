import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/shared/errors/domain-error";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  policy: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformAdmin: mocks.auth,
}));
vi.mock("@/shared/config/env", () => ({
  getServerConfig: () => ({ BETTER_AUTH_URL: "http://localhost:3000" }),
}));
vi.mock("@/modules/platform/backups/repository", () => ({
  BackupRepository: class {
    policy = mocks.policy;
    updatePolicy = mocks.update;
  },
}));

import { GET, PATCH } from "@/app/api/platform/backups/policy/route";

const input = {
  enabled: true,
  scope: "FULL_PLATFORM",
  frequency: "DAILY",
  executionTime: "02:00",
  timezone: "UTC",
  retentionCount: 7,
};
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/platform/backups/policy", {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ adminId: "admin" });
  mocks.policy.mockResolvedValue(input);
  mocks.update.mockResolvedValue(input);
});
it("policy GET and PATCH require platform admin", async () => {
  mocks.auth.mockRejectedValue(
    new DomainError("UNAUTHENTICATED", "Sign-in required."),
  );
  expect(
    (
      await GET(
        new Request("http://localhost:3000/api/platform/backups/policy"),
      )
    ).status,
  ).toBe(401);
  expect((await PATCH(request(input))).status).toBe(401);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("policy mutation requires same origin", async () => {
  expect((await PATCH(request(input, "https://other.test"))).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("valid daily and weekly policies accepted", async () => {
  for (const policy of [input, { ...input, frequency: "WEEKLY", weekday: 2 }])
    expect((await PATCH(request(policy))).status).toBe(200);
  expect(
    (
      await GET(
        new Request("http://localhost:3000/api/platform/backups/policy"),
      )
    ).status,
  ).toBe(200);
});
it.each([
  { frequency: "WEEKLY" },
  { retentionCount: 0 },
  { retentionCount: 101 },
  { path: "/private" },
])("invalid policy rejected %j", async (change) => {
  expect((await PATCH(request({ ...input, ...change }))).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
