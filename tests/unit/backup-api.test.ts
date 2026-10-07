import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/shared/errors/domain-error";
vi.mock("@/shared/config/env", () => ({
  getServerConfig: () => ({ BETTER_AUTH_URL: "http://localhost:3000" }),
}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enqueue: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformAdmin: mocks.auth,
}));
vi.mock("@/modules/platform/backups/repository", () => ({
  BackupRepository: class {
    enqueue = mocks.enqueue;
    list = mocks.list;
    detail = mocks.detail;
  },
}));
import { POST, GET } from "@/app/api/platform/backups/route";
import { GET as detail } from "@/app/api/platform/backups/[jobId]/route";
const origin = "http://localhost:3000";
function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/platform/backups`, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ adminId: "admin" });
  mocks.enqueue.mockResolvedValue({ id: "job", state: "QUEUED" });
  mocks.list.mockResolvedValue([]);
});
it("requires authentication on list, detail and creation", async () => {
  mocks.auth.mockRejectedValue(
    new DomainError("UNAUTHENTICATED", "Sign-in required."),
  );
  expect((await POST(request({ scope: "FULL_PLATFORM" }))).status).toBe(401);
  expect(
    (await GET(new Request(`${origin}/api/platform/backups`))).status,
  ).toBe(401);
  expect(
    (
      await detail(new Request(`${origin}/api/platform/backups/job`), {
        params: Promise.resolve({ jobId: "job" }),
      })
    ).status,
  ).toBe(401);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("rejects cross-origin mutations before enqueue", async () => {
  expect(
    (await POST(request({ scope: "FULL_PLATFORM" }, "https://attacker.test")))
      .status,
  ).toBe(403);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("queues full and tenant requests using authenticated actor and generated request ID", async () => {
  for (const input of [
    { scope: "FULL_PLATFORM" },
    { scope: "TENANT", tenantId: "11111111-1111-4111-8111-111111111111" },
  ])
    expect((await POST(request(input))).status).toBe(200);
  expect(mocks.enqueue).toHaveBeenCalledWith(
    { scope: "FULL_PLATFORM" },
    "admin",
    expect.stringMatching(/^[a-f0-9-]{36}$/),
  );
});
it.each([
  { scope: "FULL_PLATFORM", databaseName: "eventos_control" },
  { scope: "FULL_PLATFORM", path: "/private" },
  { scope: "FULL_PLATFORM", backupKey: "supplied" },
  { scope: "TENANT" },
])("rejects unsafe browser fields %j", async (input) => {
  expect((await POST(request(input))).status).toBe(400);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("bounds listing and validates detail UUID", async () => {
  expect(
    (await GET(new Request(`${origin}/api/platform/backups?limit=101`))).status,
  ).toBe(400);
  expect(
    (await GET(new Request(`${origin}/api/platform/backups?limit=2&offset=1`)))
      .status,
  ).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(2, 1);
  expect(
    (
      await detail(new Request(`${origin}/api/platform/backups/job`), {
        params: Promise.resolve({ jobId: "invalid" }),
      })
    ).status,
  ).toBe(400);
});
