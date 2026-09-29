import "server-only";

import { headers } from "next/headers";
import { DomainError } from "@/shared/errors/domain-error";
import {
  getTenantAuth,
  type TenantContext,
} from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { normalizeHostHeader } from "@/modules/tenants/host";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import {
  canAuthenticateTenantUser,
  isTenantSessionBoundTo,
  resolveEffectivePermissions,
} from "@/modules/tenant-identity/policy";

export type TenantActor = Readonly<{
  id: string;
  email: string;
  name: string;
  tenantId: string;
  authenticationLevel: string;
  permissions: ReadonlySet<string>;
}>;

export type TenantRequestAuth = Readonly<{
  tenant: TenantContext;
  actor: TenantActor;
  origin: string;
}>;

export async function resolveTenantFromHeaders(
  requestHeaders: Headers,
): Promise<Readonly<{ tenant: TenantContext; origin: string }>> {
  const host = requestHeaders.get("host");
  if (!host) throw new DomainError("NOT_FOUND", "Tenant not found.");
  const tenant = await resolveTenantContext(host);
  const hostname = normalizeHostHeader(host);
  const localHost = hostname === "localhost" || hostname.endsWith(".localhost");
  const protocol =
    process.env.NODE_ENV === "production" && !localHost
      ? "https:"
      : requestHeaders.get("x-forwarded-proto") === "https"
        ? "https:"
        : "http:";
  const parsedHost = new URL(`${protocol}//${host}`);
  const port = parsedHost.port ? `:${parsedHost.port}` : "";
  return { tenant, origin: `${protocol}//${hostname}${port}` };
}

export async function resolveTenantRequest(
  request: Request,
): Promise<Readonly<{ tenant: TenantContext; origin: string }>> {
  const host = request.headers.get("host");
  if (!host) throw new DomainError("NOT_FOUND", "Tenant not found.");
  const tenant = await resolveTenantContext(host);
  const requestUrl = new URL(request.url);
  if (normalizeHostHeader(host) !== tenant.hostname) {
    throw new DomainError("FORBIDDEN", "The request host is invalid.");
  }
  if (!["http:", "https:"].includes(requestUrl.protocol)) {
    throw new DomainError("FORBIDDEN", "The request origin is invalid.");
  }
  const originHeader = request.headers.get("origin");
  let origin = `${requestUrl.protocol}//${host}`;
  if (originHeader) {
    try {
      const parsedOrigin = new URL(originHeader);
      if (
        !["http:", "https:"].includes(parsedOrigin.protocol) ||
        parsedOrigin.username ||
        parsedOrigin.password ||
        parsedOrigin.pathname !== "/" ||
        parsedOrigin.search ||
        parsedOrigin.hash ||
        parsedOrigin.host.toLowerCase() !== host.toLowerCase()
      ) {
        throw new Error("origin mismatch");
      }
      origin = parsedOrigin.origin;
    } catch {
      throw new DomainError("FORBIDDEN", "The request origin is invalid.");
    }
  }
  return { tenant, origin };
}

export function assertTenantSameOrigin(request: Request, origin: string): void {
  const header = request.headers.get("origin");
  if (!header) {
    throw new DomainError("FORBIDDEN", "An Origin header is required.");
  }
  try {
    const parsed = new URL(header);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== origin
    ) {
      throw new Error("origin mismatch");
    }
  } catch {
    throw new DomainError(
      "FORBIDDEN",
      "Cross-origin requests are not allowed.",
    );
  }
}

export async function requireTenantActor(
  tenant: TenantContext,
  origin: string,
  requestHeaders: Headers,
): Promise<TenantActor> {
  const auth = getTenantAuth(tenant, origin);
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    throw new DomainError("UNAUTHENTICATED", "Sign-in is required.");
  }
  const sessionTenantId = (session.session as { tenantId?: unknown }).tenantId;
  const authenticationLevel = (
    session.session as { authenticationLevel?: unknown }
  ).authenticationLevel;
  if (!isTenantSessionBoundTo(sessionTenantId, tenant.tenantId)) {
    throw new DomainError("UNAUTHENTICATED", "Sign-in is required.");
  }
  const pool = getTenantPool(tenant);
  const user = await pool.query<{
    id: string;
    email: string;
    name: string;
    status: string;
    locked_until: Date | null;
  }>(
    `SELECT id, email, name, status, "lockedUntil" AS locked_until
     FROM tenant_users WHERE id = $1 AND "tenantId" = $2`,
    [session.user.id, tenant.tenantId],
  );
  const row = user.rows[0];
  if (
    !row ||
    !canAuthenticateTenantUser(
      row.status as "ACTIVE" | "INVITED" | "SUSPENDED" | "DISABLED",
      row.locked_until,
    )
  ) {
    throw new DomainError("UNAUTHENTICATED", "Sign-in is required.");
  }
  const grants = await pool.query<{ permission_key: string }>(
    `SELECT DISTINCT role_permission.permission_key
     FROM tenant_user_roles AS user_role
     JOIN tenant_role_permissions AS role_permission
       ON role_permission.tenant_id = user_role.tenant_id AND role_permission.role_id = user_role.role_id
     WHERE user_role.tenant_id = $1 AND user_role.user_id = $2`,
    [tenant.tenantId, row.id],
  );
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    tenantId: tenant.tenantId,
    authenticationLevel:
      typeof authenticationLevel === "string"
        ? authenticationLevel
        : "PASSWORD",
    permissions: resolveEffectivePermissions([
      grants.rows.map((grant) => grant.permission_key),
    ]),
  };
}

export async function requireTenantPageActor(
  requiredPermission?: string,
): Promise<Readonly<{ tenant: TenantContext; actor: TenantActor }>> {
  const requestHeaders = await headers();
  const { tenant, origin } = await resolveTenantFromHeaders(requestHeaders);
  const actor = await requireTenantActor(tenant, origin, requestHeaders);
  if (requiredPermission) authorize(actor.permissions, requiredPermission);
  return { tenant, actor };
}

export async function currentTenantHeaders(): Promise<Headers> {
  return headers();
}
