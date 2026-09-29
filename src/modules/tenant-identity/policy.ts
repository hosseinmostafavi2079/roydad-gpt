import { DomainError } from "@/shared/errors/domain-error";

export type TenantUserStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
export type TenantProfileType = "STAFF" | "INSTRUCTOR" | "PARTICIPANT";

export function tenantStatusPermission(
  profileType: TenantProfileType,
  status: "ACTIVE" | "SUSPENDED" | "DISABLED",
): string {
  if (profileType === "STAFF" && status === "DISABLED") {
    return "staff.delete";
  }
  return {
    STAFF: "staff.suspend",
    INSTRUCTOR: "instructor.suspend",
    PARTICIPANT: "participant.suspend",
  }[profileType];
}

export function resolveEffectivePermissions(
  rolePermissions: Iterable<Iterable<string>>,
): ReadonlySet<string> {
  const effective = new Set<string>();
  for (const role of rolePermissions) {
    for (const permission of role) effective.add(permission);
  }
  return effective;
}

export function canAuthenticateTenantUser(
  status: TenantUserStatus,
  lockedUntil: Date | null,
  now = new Date(),
): boolean {
  return status === "ACTIVE" && (!lockedUntil || lockedUntil <= now);
}

export function isTenantSessionBoundTo(
  sessionTenantId: unknown,
  resolvedTenantId: string,
): boolean {
  return (
    typeof sessionTenantId === "string" &&
    sessionTenantId.length > 0 &&
    sessionTenantId === resolvedTenantId
  );
}

export function isTenantActorBoundTo(
  actorTenantId: unknown,
  resolvedTenantId: string,
): boolean {
  return isTenantSessionBoundTo(actorTenantId, resolvedTenantId);
}

export function isTenantInvitationToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isTenantInvitationAcceptable(
  invitation: Readonly<{
    status: string;
    expiresAt: Date | string;
    consumedAt: Date | null;
    revokedAt: Date | null;
  }>,
  now = new Date(),
): boolean {
  const expiresAt =
    invitation.expiresAt instanceof Date
      ? invitation.expiresAt
      : new Date(invitation.expiresAt);
  return (
    invitation.status === "INVITED" &&
    !invitation.consumedAt &&
    !invitation.revokedAt &&
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt > now
  );
}

export function assertRoleIsMutable(isSystem: boolean): void {
  if (isSystem) {
    throw new DomainError("FORBIDDEN", "System roles cannot be edited.");
  }
}

export function assertOwnerRoleGrantsPreserved(
  roleCode: string,
  activeAssignments: number,
  currentPermissions: Iterable<string>,
  nextPermissions: ReadonlySet<string>,
): void {
  if (
    roleCode === "organization_owner" &&
    activeAssignments > 0 &&
    [...currentPermissions].some(
      (permission) => !nextPermissions.has(permission),
    )
  ) {
    throw new DomainError("FORBIDDEN", "Owner role grants cannot be reduced.");
  }
}
