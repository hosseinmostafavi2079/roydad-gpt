export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "FEATURE_DISABLED"
  | "LIMIT_REACHED"
  | "TENANT_LIMIT_REACHED"
  | "DOMAIN_UNVERIFIED"
  | "TENANT_NOT_ACTIVE"
  | "PROVISIONING_FAILED"
  | "RATE_LIMITED"
  | "CAPACITY_REACHED"
  | "REGISTRATION_CLOSED"
  | "ALREADY_ENROLLED";

const statusByCode: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  FEATURE_DISABLED: 403,
  LIMIT_REACHED: 409,
  TENANT_LIMIT_REACHED: 409,
  DOMAIN_UNVERIFIED: 403,
  TENANT_NOT_ACTIVE: 403,
  PROVISIONING_FAILED: 409,
  RATE_LIMITED: 429,
  CAPACITY_REACHED: 409,
  REGISTRATION_CLOSED: 409,
  ALREADY_ENROLLED: 409,
};

export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DomainError";
    this.status = statusByCode[code];
  }
}
