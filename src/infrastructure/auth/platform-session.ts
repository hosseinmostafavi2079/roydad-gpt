import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DomainError } from "@/shared/errors/domain-error";
import { getAuth } from "@/infrastructure/auth/auth";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { requestIdFrom } from "@/shared/http/api-response";
import { getServerConfig } from "@/shared/config/env";

export type PlatformActor = Readonly<{
  adminId: string;
  userId: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}>;

export async function requirePlatformAdmin(options?: {
  requestHeaders?: Headers;
  allowMfaEnrollment?: boolean;
}): Promise<PlatformActor> {
  const requestHeaders = options?.requestHeaders ?? (await headers());
  const requestHost = requestHeaders.get("host")?.toLowerCase();
  const platformHost = new URL(
    getServerConfig().BETTER_AUTH_URL,
  ).host.toLowerCase();
  if (!requestHost || requestHost !== platformHost) {
    throw new DomainError(
      "NOT_FOUND",
      "No platform administration is available on this host.",
    );
  }
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    throw new DomainError("UNAUTHENTICATED", "Sign-in is required.");
  }

  const result = await getControlPool().query<{
    id: string;
    email: string;
    display_name: string;
    revoked_at: Date | null;
  }>(
    `SELECT admin.id, admin.email, admin.display_name, admin.revoked_at
     FROM platform_admins AS admin
     WHERE admin.auth_user_id = $1`,
    [session.user.id],
  );
  const admin = result.rows[0];
  if (!admin || admin.revoked_at) {
    throw new DomainError(
      "FORBIDDEN",
      "Platform administrator access is not active.",
    );
  }

  const config = getServerConfig();
  const twoFactorEnabled = Boolean(
    "twoFactorEnabled" in session.user && session.user.twoFactorEnabled,
  );
  if (
    config.PLATFORM_REQUIRE_MFA &&
    !twoFactorEnabled &&
    !options?.allowMfaEnrollment
  ) {
    throw new DomainError(
      "FORBIDDEN",
      "Enroll a TOTP authenticator before using platform administration.",
    );
  }

  return {
    adminId: admin.id,
    userId: session.user.id,
    email: admin.email,
    name: admin.display_name,
    twoFactorEnabled,
  };
}

export async function requirePlatformPageAdmin(options?: {
  allowMfaEnrollment?: boolean;
}): Promise<PlatformActor> {
  try {
    return await requirePlatformAdmin(options);
  } catch (error) {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED") {
      redirect("/sign-in");
    }
    if (
      error instanceof DomainError &&
      error.code === "FORBIDDEN" &&
      options?.allowMfaEnrollment
    ) {
      throw error;
    }
    if (error instanceof DomainError && error.code === "FORBIDDEN") {
      redirect("/platform/security/mfa");
    }
    throw error;
  }
}

export async function auditAuthFailure(
  request: Request,
  action: string,
  actorId?: string,
): Promise<void> {
  const requestId = requestIdFrom(request);
  await getControlPool().query(
    `INSERT INTO platform_audit_logs
       (actor_type, actor_id, action, target_type, target_id, request_id, source_ip)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [
      "PLATFORM_ADMIN",
      actorId ?? null,
      action,
      "AUTH",
      actorId ?? null,
      requestId,
    ],
  );
}
