import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
vi.mock("@/shared/config/env", () => ({
  getServerConfig: () => ({
    TENANT_BOOTSTRAP_ENCRYPTION_KEY: "a".repeat(48),
    BETTER_AUTH_SECRET: "b".repeat(48),
  }),
}));
import {
  encryptTenantOwnerBootstrap,
  decryptTenantOwnerBootstrap,
} from "@/infrastructure/auth/tenant-bootstrap";
import { createTenantSchema } from "@/modules/platform/tenants/schema";
describe("initial owner activation bootstrap", () => {
  const tenant = randomUUID();
  const owner = {
    name: "Initial Owner",
    username: "initial_owner",
    mobile: "+989121234591",
    activationCode: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  it("encrypts activation access without plaintext at rest", () => {
    const encrypted = encryptTenantOwnerBootstrap(tenant, owner);
    expect(encrypted.includes(Buffer.from(owner.activationCode))).toBe(false);
    expect(decryptTenantOwnerBootstrap(tenant, encrypted)).toEqual(owner);
  });
  it("retains the existing encrypted email bootstrap", () => {
    const legacy = { name: "Initial Owner", email: "owner@example.test" };
    expect(
      decryptTenantOwnerBootstrap(
        tenant,
        encryptTenantOwnerBootstrap(tenant, legacy),
      ),
    ).toEqual(legacy);
  });
  it("rejects another tenant and tampered ciphertext", () => {
    const encrypted = encryptTenantOwnerBootstrap(tenant, owner);
    expect(() =>
      decryptTenantOwnerBootstrap(randomUUID(), encrypted),
    ).toThrow();
    encrypted[encrypted.length - 1] =
      (encrypted[encrypted.length - 1] ?? 0) ^ 1;
    expect(() => decryptTenantOwnerBootstrap(tenant, encrypted)).toThrow();
  });
  it("normalizes Iranian mobile and existing username rules with optional email", () => {
    const parsed = createTenantSchema.parse({
      slug: "initial-tenant",
      displayName: "Initial Tenant",
      planCode: "foundation",
      ownerName: "Initial Owner",
      ownerUsername: "OWNER_123",
      ownerMobile: "۰۹۱۲ ۱۲۳۴ ۵۹۱",
    });
    expect(parsed.ownerUsername).toBe("owner_123");
    expect(parsed.ownerMobile).toBe("+989121234591");
    expect(parsed.ownerEmail).toBeUndefined();
  });
  it.each(["admin", "root", "a", "invalid-name"])(
    "rejects reserved/invalid owner username %s",
    (username) => {
      expect(() =>
        createTenantSchema.parse({
          slug: "initial-tenant",
          displayName: "Initial Tenant",
          planCode: "foundation",
          ownerName: "Initial Owner",
          ownerUsername: username,
          ownerMobile: "09121234591",
        }),
      ).toThrow();
    },
  );
});
