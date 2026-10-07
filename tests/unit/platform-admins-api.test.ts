import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/shared/errors/domain-error";

vi.mock("@/shared/config/env", () => ({
  getServerConfig: () => ({ BETTER_AUTH_URL: "http://localhost:3000" }),
}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  activate: vi.fn(),
  regenerate: vi.fn(),
  revoke: vi.fn(),
  reactivate: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformAdmin: mocks.auth,
}));
vi.mock("@/modules/platform/admins/repository", () => ({
  PlatformAdminRepository: class {
    listPlatformAdmins = mocks.list;
    createPlatformAdmin = mocks.create;
    activatePlatformAdmin = mocks.activate;
    regenerateActivation = mocks.regenerate;
    revokePlatformAdmin = mocks.revoke;
    reactivatePlatformAdmin = mocks.reactivate;
    revokePlatformAdminSessions = mocks.sessions;
  },
}));

import { POST as regenerate } from "@/app/api/platform/admins/[adminId]/activation/regenerate/route";
import { POST as reactivate } from "@/app/api/platform/admins/[adminId]/reactivate/route";
import { POST as revoke } from "@/app/api/platform/admins/[adminId]/revoke/route";
import { POST as sessions } from "@/app/api/platform/admins/[adminId]/sessions/revoke/route";
import { GET, POST } from "@/app/api/platform/admins/route";
import { POST as activate } from "@/app/api/platform-activation/route";

const id = "11111111-1111-4111-8111-111111111111",
  origin = "http://localhost:3000",
  context = { params: Promise.resolve({ adminId: id }) };
const body = { email: "admin@example.test", displayName: "Test Admin" };
const activation = {
  email: body.email,
  activationCode: "fake-unit-only-code",
  password: "A sufficiently long password 2026",
  confirmPassword: "A sufficiently long password 2026",
};
const request = (
  value: unknown,
  requestOrigin = origin,
  host = "localhost:3000",
) =>
  new Request(`${origin}/api/platform/admins`, {
    method: "POST",
    headers: {
      host,
      origin: requestOrigin,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ adminId: id });
  mocks.list.mockResolvedValue({ items: [], activeCount: 1 });
  for (const key of [
    "create",
    "regenerate",
    "revoke",
    "reactivate",
    "sessions",
  ] as const)
    mocks[key].mockResolvedValue({ id });
  mocks.activate.mockResolvedValue({ activated: true });
});
it.each(["create", "regenerate", "revoke", "reactivate", "sessions"])(
  "%s requires authentication",
  async (name) => {
    mocks.auth.mockRejectedValue(
      new DomainError("UNAUTHENTICATED", "Required"),
    );
    const response =
      name === "create"
        ? await POST(request(body))
        : await { regenerate, revoke, reactivate, sessions }[
            name as "regenerate"
          ](request({}), context);
    expect(response.status).toBe(401);
  },
);
it("list requires authentication", async () => {
  mocks.auth.mockRejectedValue(new DomainError("UNAUTHENTICATED", "Required"));
  expect((await GET(new Request(origin))).status).toBe(401);
});
it.each(["create", "regenerate", "revoke", "reactivate", "sessions"])(
  "%s requires same origin",
  async (name) => {
    const response =
      name === "create"
        ? await POST(request(body, "https://attacker.test"))
        : await { regenerate, revoke, reactivate, sessions }[
            name as "regenerate"
          ](request({}, "https://attacker.test"), context);
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  },
);
it("create normalizes input, uses actor and request ID, response is not cacheable", async () => {
  const response = await POST(
    request({ ...body, email: " ADMIN@EXAMPLE.TEST " }),
  );
  expect(response.status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(
    body,
    id,
    expect.stringMatching(/^[a-f0-9-]{36}$/),
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it.each([
  { ...body, password: "never-allowed" },
  { ...body, role: "admin" },
  { ...body, displayName: "" },
  { ...body, email: "invalid" },
])("rejects invalid/privileged creation fields", async (value) => {
  expect((await POST(request(value))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each([regenerate, revoke, reactivate, sessions])(
  "action requires strict empty body and UUID",
  async (handler) => {
    expect(
      (await handler(request({ password: "forbidden" }), context)).status,
    ).toBe(400);
    expect(
      (
        await handler(request({}), {
          params: Promise.resolve({ adminId: "bad" }),
        })
      ).status,
    ).toBe(400);
    expect((await handler(request({}), context)).status).toBe(200);
  },
);
it.each(["tenant.localhost:3000", "custom.example.test", "localhost:3001"])(
  "activation rejects noncanonical host %s",
  async (host) => {
    expect((await activate(request(activation, origin, host))).status).toBe(
      404,
    );
    expect(mocks.activate).not.toHaveBeenCalled();
  },
);
it("activation accepts canonical host without admin session and requires same-origin", async () => {
  expect((await activate(request(activation))).status).toBe(200);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(
    (await activate(request(activation, "https://attacker.test"))).status,
  ).toBe(403);
});
it.each([
  { ...activation, password: "short" },
  { ...activation, confirmPassword: "A completely different long password" },
  {
    ...activation,
    password: "x".repeat(129),
    confirmPassword: "x".repeat(129),
  },
  { ...activation, adminId: id },
])("activation strictly validates password and fields", async (value) => {
  expect((await activate(request(value))).status).toBe(400);
  expect(mocks.activate).not.toHaveBeenCalled();
});
it("errors never serialize exception secrets", async () => {
  mocks.create.mockRejectedValue(new Error("password and activation secrets"));
  const response = await POST(request(body));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toMatch(/activation secrets|password and/);
});
it("safe list and bounded offset", async () => {
  expect((await GET(new Request(`${origin}?offset=10001`))).status).toBe(400);
  expect((await GET(new Request(`${origin}?offset=100`))).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(id, 100);
});
