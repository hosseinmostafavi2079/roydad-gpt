import { cleanResponse } from "@/modules/tenant-identity/auth-response";
import { getTenantAuth } from "@/modules/tenant-identity/auth";
import {
  handleIdentityV2Auth,
  isIdentityV2Path,
} from "@/modules/tenant-identity/identity-v2-auth-route";
import { getIdentitySettings } from "@/modules/tenant-identity/identity-v2-repository";
import {
  assertTenantSameOrigin,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { getControlPool } from "@/infrastructure/db/control/pool";
import type { PoolClient } from "pg";
import { assertEmailServiceAvailable } from "@/infrastructure/auth/mailer";
import { jsonResponse, requestIdFrom } from "@/shared/http/api-response";
import { DomainError } from "@/shared/errors/domain-error";
import { googleOAuthEnabledForOrigin } from "@/modules/tenant-identity/google-config";
import {
  safeParticipantDestination,
  safeAuthCallbackDestination,
} from "@/modules/tenant-identity/auth-destination";

export const runtime = "nodejs";

const allowedGetPaths = new Set([
  "/get-session",
  "/verify-email",
  "/callback/google",
]);
const allowedPostPaths = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-out",
  "/forget-password",
  "/reset-password",
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-in/social",
]);

function safeGoogleErrorDestination(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith("/login?")) return false;
  const parsed = new URL(value, "http://localhost");
  return (
    parsed.pathname === "/login" &&
    parsed.origin === "http://localhost" &&
    parsed.searchParams.get("participant") === "1" &&
    parsed.searchParams.size === 2 &&
    safeParticipantDestination(parsed.searchParams.get("next")) !== null
  );
}

async function readAuthRequestBody(request: Request): Promise<string> {
  const maximumBytes = 65_536;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumBytes ||
    !request.body
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Request body is invalid or exceeds the allowed size.",
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new DomainError(
          "VALIDATION_FAILED",
          "Request body exceeds the allowed size.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("VALIDATION_FAILED", "Request body is invalid.");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Request body is invalid.");
  }
}

async function handle(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  let signupLock: PoolClient | undefined;
  let signupLockKey: string | undefined;
  let socialRequestBody: string | undefined;
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const path = new URL(request.url).pathname.replace(
      /^\/api\/tenant-auth/,
      "",
    );
    if (isIdentityV2Path(path)) {
      assertTenantSameOrigin(request, origin);
      return await handleIdentityV2Auth(request, tenant, origin, path);
    }
    const identitySettings = await getIdentitySettings(tenant);
    if (
      [
        "/sign-in/email",
        "/sign-up/email",
        "/forget-password",
        "/reset-password",
        "/verify-email",
      ].includes(path) ||
      path.includes("email-otp")
    )
      assertEmailServiceAvailable();
    const method =
      path === "/sign-in/email" ||
      path === "/sign-up/email" ||
      path === "/forget-password" ||
      path === "/reset-password"
        ? "email_password"
        : path.includes("email-otp")
          ? "email_otp"
          : path === "/sign-in/social" || path === "/callback/google"
            ? "google"
            : null;
    if (method && !identitySettings.methods[method])
      throw new DomainError("FEATURE_DISABLED", "این روش ورود فعال نیست.");
    if (
      (request.method === "GET" && !allowedGetPaths.has(path)) ||
      (request.method === "POST" && !allowedPostPaths.has(path)) ||
      !["GET", "POST"].includes(request.method)
    ) {
      throw new DomainError("NOT_FOUND", "Authentication endpoint not found.");
    }
    if (request.method !== "GET") assertTenantSameOrigin(request, origin);
    const socialPath =
      path === "/sign-in/social" || path === "/callback/google";
    if (
      socialPath &&
      (!tenant.features.google_login || !googleOAuthEnabledForOrigin(origin))
    )
      throw new DomainError(
        "FEATURE_DISABLED",
        "Google sign-in is unavailable.",
      );
    if (
      (path === "/sign-in/email" || path === "/sign-up/email") &&
      !tenant.features.password_login
    )
      throw new DomainError(
        "FEATURE_DISABLED",
        "Password login is unavailable.",
      );
    if (path === "/sign-up/email" && !tenant.features.registration)
      throw new DomainError("FEATURE_DISABLED", "Registration is unavailable.");
    if (path === "/sign-up/email") {
      signupLock = await getControlPool().connect();
      signupLockKey = `participant-signup:${tenant.tenantId}`;
      await signupLock.query(
        "SELECT pg_advisory_lock(hashtextextended($1,0))",
        [signupLockKey],
      );
      const count = await getTenantPool(tenant).query<{ count: number }>(
        "SELECT count(*)::int AS count FROM tenant_participant_profiles WHERE tenant_id=$1",
        [tenant.tenantId],
      );
      if ((count.rows[0]?.count ?? 0) >= tenant.limits.max_participants)
        throw new DomainError(
          "LIMIT_REACHED",
          "ظرفیت ثبت‌نام حساب‌های جدید تکمیل شده است.",
        );
    }
    if (path === "/sign-in/social") {
      const body = await readAuthRequestBody(request);
      socialRequestBody = body;
      let input: {
        provider?: unknown;
        callbackURL?: unknown;
        errorCallbackURL?: unknown;
        requestSignUp?: unknown;
      };
      try {
        input = JSON.parse(body) as typeof input;
      } catch {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Invalid social sign-in request.",
        );
      }
      if (
        input.provider !== "google" ||
        !safeAuthCallbackDestination(input.callbackURL) ||
        (input.errorCallbackURL !== undefined &&
          !safeGoogleErrorDestination(input.errorCallbackURL)) ||
        (input.requestSignUp !== undefined && input.requestSignUp !== true)
      )
        throw new DomainError(
          "VALIDATION_FAILED",
          "Invalid social sign-in request.",
        );
    }
    if (path === "/callback/google") {
      signupLock = await getControlPool().connect();
      signupLockKey = `participant-signup:${tenant.tenantId}`;
      await signupLock.query(
        "SELECT pg_advisory_lock(hashtextextended($1,0))",
        [signupLockKey],
      );
    }
    const otpPath =
      path === "/email-otp/send-verification-otp" ||
      path === "/sign-in/email-otp";
    if (otpPath && !tenant.features.email_otp)
      throw new DomainError(
        "FEATURE_DISABLED",
        "Email code login is unavailable.",
      );
    const auth = getTenantAuth(tenant, origin);
    let attemptedEmail: string | undefined;
    let authRequest = request;
    if (socialRequestBody !== undefined) {
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      authRequest = new Request(request.url, {
        method: request.method,
        headers,
        body: socialRequestBody,
        signal: request.signal,
      });
    }
    if (path === "/sign-in/email" || otpPath) {
      const requestBody = await readAuthRequestBody(request);
      if (path === "/email-otp/send-verification-otp") {
        try {
          const input = JSON.parse(requestBody) as {
            type?: unknown;
            email?: unknown;
          };
          if (
            input.type !== "sign-in" ||
            typeof input.email !== "string" ||
            input.email.length > 320
          )
            throw new Error("invalid OTP request");
        } catch {
          throw new DomainError("VALIDATION_FAILED", "Invalid code request.");
        }
      }
      const authHeaders = new Headers(request.headers);
      authHeaders.delete("content-length");
      authRequest = new Request(request.url, {
        method: request.method,
        headers: authHeaders,
        body: requestBody,
        signal: request.signal,
      });
      try {
        const body = JSON.parse(requestBody) as { email?: unknown };
        if (typeof body.email === "string" && body.email.length <= 320) {
          attemptedEmail = body.email.trim().toLowerCase();
        }
      } catch {
        attemptedEmail = undefined;
      }
    }
    const sessionBeforeSignOut =
      path === "/sign-out"
        ? await auth.api.getSession({ headers: request.headers })
        : null;
    const response = await auth.handler(authRequest);
    if (
      path === "/email-otp/send-verification-otp" &&
      response.status !== 429 &&
      response.status < 500
    ) {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "private, no-store, max-age=0");
      return jsonResponse({ success: true }, { status: 200, headers });
    }
    if (path === "/sign-up/email" && response.ok) {
      const payload = (await response.clone().json()) as {
        user?: { id?: unknown; name?: unknown };
      };
      if (typeof payload.user?.id === "string") {
        await getTenantPool(tenant).query(
          `INSERT INTO tenant_participant_profiles (tenant_id, user_id, display_name)
           SELECT "tenantId", id, name FROM tenant_users
           WHERE "tenantId"=$1 AND id=$2
           ON CONFLICT (tenant_id, user_id) DO NOTHING`,
          [tenant.tenantId, payload.user.id],
        );
        await getTenantPool(tenant).query(
          `INSERT INTO tenant_user_roles (tenant_id,user_id,role_id)
           SELECT $1,$2,id FROM tenant_roles WHERE tenant_id=$1 AND code='participant'
           ON CONFLICT DO NOTHING`,
          [tenant.tenantId, payload.user.id],
        );
      }
    }
    if (
      path === "/sign-in/email" &&
      response.status === 401 &&
      attemptedEmail
    ) {
      try {
        const pool = getTenantPool(tenant);
        await pool.query(
          `UPDATE tenant_users SET "failedLoginCount" = "failedLoginCount" + 1,
             "lockedUntil" = CASE WHEN "failedLoginCount" + 1 >= 10 THEN now() + interval '15 minutes' ELSE "lockedUntil" END,
             "updatedAt" = now()
           WHERE "tenantId" = $1 AND email = $2`,
          [tenant.tenantId, attemptedEmail],
        );
      } catch {
        // Authentication failures remain generic if bookkeeping is temporarily unavailable.
      }
    }
    if (sessionBeforeSignOut && response.status < 400) {
      const pool = getTenantPool(tenant);
      for (const action of ["session.revoked", "auth.signed_out"]) {
        await pool.query(
          `INSERT INTO tenant_audit_logs
             (tenant_id, actor_id, action, target_type, target_id, request_id, after_state)
           VALUES ($1, $2, $3, 'TENANT_USER', $2, $4, $5::jsonb)`,
          [
            tenant.tenantId,
            sessionBeforeSignOut.user.id,
            action,
            requestId,
            JSON.stringify({
              authenticationLevel: "PASSWORD",
              reason: "user_signed_out",
            }),
          ],
        );
      }
    }
    return await cleanResponse(response, path);
  } catch (error) {
    return jsonResponse(
      {
        error: {
          code: error instanceof DomainError ? error.code : "INTERNAL_ERROR",
          message:
            error instanceof DomainError
              ? error.message
              : "The request could not be completed.",
          requestId,
        },
      },
      { status: error instanceof DomainError ? error.status : 500 },
    );
  } finally {
    if (signupLock && signupLockKey) {
      await signupLock
        .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          signupLockKey,
        ])
        .catch(() => undefined);
      signupLock.release();
    }
  }
}

export const GET = handle;
export const POST = handle;
