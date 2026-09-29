import { DomainError } from "@/shared/errors/domain-error";

export type TenantPermission = string;

export function isAuthorized(
  effective: ReadonlySet<TenantPermission>,
  required: TenantPermission,
): boolean {
  return effective.has(required);
}

export function authorize(
  effective: ReadonlySet<TenantPermission>,
  required: TenantPermission,
): void {
  if (!isAuthorized(effective, required)) {
    throw new DomainError(
      "FORBIDDEN",
      "You do not have permission for this action.",
    );
  }
}

export function canGrantPermissions(
  effective: ReadonlySet<TenantPermission>,
  requested: Iterable<TenantPermission>,
): boolean {
  for (const permission of requested) {
    if (!effective.has(permission)) return false;
  }
  return true;
}

export function assertCanGrantPermissions(
  effective: ReadonlySet<TenantPermission>,
  requested: Iterable<TenantPermission>,
): void {
  if (!canGrantPermissions(effective, requested)) {
    throw new DomainError(
      "FORBIDDEN",
      "You cannot grant permissions you do not hold.",
    );
  }
}

export function authorizeResource(
  input: Readonly<{
    actor: Readonly<{
      id: string;
      tenantId: string;
      permissions: ReadonlySet<TenantPermission>;
    }>;
    permission: TenantPermission;
    resource: Readonly<{
      tenantId: string;
      authorizedActorIds?: readonly string[];
    }>;
  }>,
): void {
  if (input.actor.tenantId !== input.resource.tenantId) {
    throw new DomainError("FORBIDDEN", "The resource is outside this tenant.");
  }
  authorize(input.actor.permissions, input.permission);
  if (
    input.resource.authorizedActorIds &&
    !input.resource.authorizedActorIds.includes(input.actor.id)
  ) {
    throw new DomainError(
      "FORBIDDEN",
      "You do not have access to this resource.",
    );
  }
}
