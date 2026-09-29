import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/errors/domain-error";
import {
  acceptTenantInvitationSchema,
  createTenantRoleSchema,
  inviteTenantUserSchema,
} from "@/modules/tenant-identity/schema";
import {
  assertCanGrantPermissions,
  authorize,
  authorizeResource,
} from "@/modules/tenant-identity/permissions";
import {
  assertOwnerRoleGrantsPreserved,
  assertRoleIsMutable,
  canAuthenticateTenantUser,
  isTenantInvitationAcceptable,
  isTenantInvitationToken,
  isTenantActorBoundTo,
  isTenantSessionBoundTo,
  resolveEffectivePermissions,
  tenantStatusPermission,
} from "@/modules/tenant-identity/policy";

describe("tenant identity and authorization policies", () => {
  it("unions grants from multiple roles and denies missing or contextual permissions by default", () => {
    const effective = resolveEffectivePermissions([
      ["dashboard.read", "staff.read"],
      ["attendance.manage", "dashboard.read"],
    ]);

    expect(effective).toEqual(
      new Set(["dashboard.read", "staff.read", "attendance.manage"]),
    );
    expect(() => authorize(effective, "finance.read")).toThrow(DomainError);
    const actor = {
      id: "user-a",
      tenantId: "tenant-a",
      permissions: effective,
    };
    expect(() =>
      authorizeResource({
        actor,
        permission: "attendance.manage",
        resource: { tenantId: "tenant-a", authorizedActorIds: ["user-a"] },
      }),
    ).not.toThrow();
    expect(() =>
      authorizeResource({
        actor,
        permission: "attendance.manage",
        resource: { tenantId: "tenant-a", authorizedActorIds: ["user-b"] },
      }),
    ).toThrow(DomainError);
    expect(() =>
      authorizeResource({
        actor,
        permission: "attendance.manage",
        resource: { tenantId: "tenant-b" },
      }),
    ).toThrow(DomainError);
  });

  it("prevents granting privileges the acting user does not hold", () => {
    const actorPermissions = new Set(["program.read", "program.update"]);
    expect(() =>
      assertCanGrantPermissions(actorPermissions, ["program.update"]),
    ).not.toThrow();
    expect(() =>
      assertCanGrantPermissions(actorPermissions, [
        "program.update",
        "finance.read",
      ]),
    ).toThrowError(/cannot grant permissions/i);
  });

  it("keeps system roles immutable and prevents reducing active owner grants", () => {
    expect(() => assertRoleIsMutable(false)).not.toThrow();
    expect(() => assertRoleIsMutable(true)).toThrowError(
      /system roles cannot be edited/i,
    );
    expect(() =>
      assertOwnerRoleGrantsPreserved(
        "organization_owner",
        1,
        ["dashboard.read", "settings.manage"],
        new Set(["dashboard.read"]),
      ),
    ).toThrowError(/owner role grants cannot be reduced/i);
    expect(() =>
      assertOwnerRoleGrantsPreserved(
        "support",
        1,
        ["dashboard.read"],
        new Set(),
      ),
    ).not.toThrow();
  });

  it("accepts only well-formed one-time invitation tokens and valid unconsumed invitations", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const token = "A".repeat(43);
    expect(isTenantInvitationToken(token)).toBe(true);
    expect(isTenantInvitationToken("too-short")).toBe(false);
    expect(
      acceptTenantInvitationSchema.safeParse({
        token,
        password: "long enough local password",
      }).success,
    ).toBe(true);
    expect(
      acceptTenantInvitationSchema.safeParse({
        token: "short",
        password: "long enough local password",
      }).success,
    ).toBe(false);

    const valid = {
      status: "INVITED",
      expiresAt: new Date("2026-09-29T12:00:00Z"),
      consumedAt: null,
      revokedAt: null,
    };
    expect(isTenantInvitationAcceptable(valid, now)).toBe(true);
    expect(
      isTenantInvitationAcceptable(
        { ...valid, expiresAt: new Date("2026-09-28T12:00:00Z") },
        now,
      ),
    ).toBe(false);
    expect(
      isTenantInvitationAcceptable(
        { ...valid, consumedAt: new Date("2026-09-28T11:00:00Z") },
        now,
      ),
    ).toBe(false);
    expect(
      isTenantInvitationAcceptable(
        { ...valid, revokedAt: new Date("2026-09-28T11:00:00Z") },
        now,
      ),
    ).toBe(false);
    expect(
      isTenantInvitationAcceptable({ ...valid, status: "SUSPENDED" }, now),
    ).toBe(false);
  });

  it("allows authentication only for active, unlocked accounts", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(canAuthenticateTenantUser("ACTIVE", null, now)).toBe(true);
    expect(
      canAuthenticateTenantUser(
        "ACTIVE",
        new Date("2026-09-28T11:59:00Z"),
        now,
      ),
    ).toBe(true);
    for (const status of ["INVITED", "SUSPENDED", "DISABLED"] as const) {
      expect(canAuthenticateTenantUser(status, null, now)).toBe(false);
    }
    expect(
      canAuthenticateTenantUser(
        "ACTIVE",
        new Date("2026-09-28T12:01:00Z"),
        now,
      ),
    ).toBe(false);
  });

  it("requires the separate staff disable permission for disabling an account", () => {
    expect(tenantStatusPermission("STAFF", "SUSPENDED")).toBe("staff.suspend");
    expect(tenantStatusPermission("STAFF", "DISABLED")).toBe("staff.delete");
    expect(tenantStatusPermission("INSTRUCTOR", "DISABLED")).toBe(
      "instructor.suspend",
    );
  });

  it("binds sessions to the resolved tenant and rejects client tenant fields", () => {
    expect(isTenantSessionBoundTo("tenant-a", "tenant-a")).toBe(true);
    expect(isTenantSessionBoundTo("tenant-a", "tenant-b")).toBe(false);
    expect(isTenantSessionBoundTo(undefined, "tenant-a")).toBe(false);
    expect(isTenantSessionBoundTo({ tenantId: "tenant-a" }, "tenant-a")).toBe(
      false,
    );
    expect(isTenantActorBoundTo("tenant-a", "tenant-b")).toBe(false);
  });

  it("rejects mass-assigned identity and role fields", () => {
    expect(
      inviteTenantUserSchema.safeParse({
        name: "Test Staff",
        email: "staff@example.test",
        roleCodes: ["support"],
        tenantId: "attacker-tenant",
        status: "ACTIVE",
      }).success,
    ).toBe(false);
    expect(
      createTenantRoleSchema.safeParse({
        code: "custom",
        name: "Custom",
        permissionKeys: ["staff.read"],
        isSystem: true,
      }).success,
    ).toBe(false);
  });
});
