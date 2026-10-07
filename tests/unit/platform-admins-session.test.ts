import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  query: vi.fn(),
  mfa: false,
  redirect: vi.fn((path: string) => {
    throw new Error(path);
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/config/env", () => ({
  getServerConfig: () => ({
    BETTER_AUTH_URL: "http://localhost:3000",
    PLATFORM_REQUIRE_MFA: mocks.mfa,
  }),
}));
vi.mock("@/infrastructure/auth/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.session } }),
}));
vi.mock("@/infrastructure/db/control/pool", () => ({
  getControlPool: () => ({ query: mocks.query }),
}));

import {
  requirePlatformAdmin,
  requirePlatformPageAdmin,
} from "@/infrastructure/auth/platform-session";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mfa = false;
  mocks.session.mockResolvedValue({
    user: { id: "user", twoFactorEnabled: false },
  });
  mocks.query.mockResolvedValue({
    rows: [
      {
        id: "admin",
        email: "admin@example.test",
        display_name: "Admin",
        activated_at: new Date(),
        revoked_at: null,
      },
    ],
  });
});
it("ACTIVE password admin enters when MFA is disabled", async () => {
  expect((await requirePlatformAdmin()).adminId).toBe("admin");
});
it("pending cannot obtain platform access even with a fabricated auth session", async () => {
  mocks.query.mockResolvedValue({
    rows: [{ id: "admin", activated_at: null, revoked_at: null }],
  });
  await expect(requirePlatformAdmin()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("revoked cannot obtain platform access", async () => {
  mocks.query.mockResolvedValue({
    rows: [{ id: "admin", activated_at: new Date(), revoked_at: new Date() }],
  });
  await expect(requirePlatformAdmin()).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("MFA requirement still redirects newly activated unenrolled admin", async () => {
  mocks.mfa = true;
  await expect(requirePlatformPageAdmin()).rejects.toThrow(
    "/platform/security/mfa",
  );
});
it("MFA enrollment guard remains available only to active admin", async () => {
  mocks.mfa = true;
  expect(
    (await requirePlatformAdmin({ allowMfaEnrollment: true })).twoFactorEnabled,
  ).toBe(false);
});
it("MFA-enrolled active admin retains access", async () => {
  mocks.mfa = true;
  mocks.session.mockResolvedValue({
    user: { id: "user", twoFactorEnabled: true },
  });
  expect((await requirePlatformAdmin()).twoFactorEnabled).toBe(true);
});
it("platform host restriction precedes authentication", async () => {
  await expect(
    requirePlatformAdmin({
      requestHeaders: new Headers({ host: "tenant.localhost:3000" }),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(mocks.session).not.toHaveBeenCalled();
});
it("public admin signup and one-time initial bootstrap remain unchanged", () => {
  const auth = readFileSync("src/infrastructure/auth/auth.ts", "utf8");
  expect(auth).toContain("disableSignUp: true");
  const script = readFileSync("scripts/bootstrap-production-admin.ts", "utf8");
  expect(script).toContain("existing.rows[0]?.count !== 0");
});
