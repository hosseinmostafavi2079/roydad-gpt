import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getTenantAuth, type TenantContext } from "./auth";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { hashPlatformPassword } from "@/infrastructure/auth/password";
import {
  normalizeIranianPhone,
  normalizeUsername,
  validateProfileValues,
} from "./identity-v2-schema";
import {
  getIdentitySettings,
  identityAudit,
  identityThrottle,
  saveParticipantProfile,
  smsAvailable,
} from "./identity-v2-repository";
import {
  jsonResponse,
  parseJson,
  requestIdFrom,
} from "@/shared/http/api-response";
import { DomainError } from "@/shared/errors/domain-error";
import { logger } from "@/infrastructure/logging/logger";

const paths = new Set([
  "/phone-number/send-otp",
  "/phone-number/verify",
  "/sign-in/username",
  "/is-username-available",
]);
export function isIdentityV2Path(path: string) {
  return paths.has(path);
}
const verifySchema = z.strictObject({
  phoneNumber: z.string().max(40),
  code: z.string().regex(/^\d{6}$/),
  updatePhoneNumber: z.boolean().optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
  username: z.string().max(30).optional(),
  password: z.string().min(12).max(128).optional(),
});

export async function handleIdentityV2Auth(
  request: Request,
  tenant: TenantContext,
  origin: string,
  path: string,
): Promise<Response> {
  const requestId = requestIdFrom(request);
  const pool = getTenantPool(tenant);
  const settings = await getIdentitySettings(tenant);
  if (request.method !== "POST")
    throw new DomainError("NOT_FOUND", "Authentication endpoint not found.");
  const phonePath = path.startsWith("/phone-number/");
  if (phonePath && !(await smsAvailable(tenant, settings)))
    throw new DomainError("FEATURE_DISABLED", "ورود پیامکی در دسترس نیست.");
  if (
    !phonePath &&
    (!settings.methods.username_password || !tenant.features.password_login)
  )
    throw new DomainError("FEATURE_DISABLED", "ورود با نام کاربری فعال نیست.");
  const input = await parseJson<{
    phoneNumber?: string;
    username?: string;
    password?: string;
    code?: string;
    updatePhoneNumber?: boolean;
    profile?: Record<string, unknown>;
  }>(
    request,
    phonePath
      ? path.endsWith("send-otp")
        ? z.strictObject({ phoneNumber: z.string().max(40) })
        : verifySchema
      : path === "/is-username-available"
        ? z.strictObject({ username: z.string().max(30) })
        : z.strictObject({
            username: z.string().max(30),
            password: z.string().max(128),
            rememberMe: z.boolean().optional(),
          }),
  );
  let phone: string | undefined;
  let usernameValue: string | undefined;
  try {
    if (typeof input.phoneNumber === "string")
      phone = normalizeIranianPhone(input.phoneNumber);
    if ("username" in input && input.username)
      usernameValue = normalizeUsername(input.username);
  } catch {
    throw new DomainError(
      "VALIDATION_FAILED",
      "شماره موبایل یا نام کاربری معتبر نیست.",
    );
  }
  const source =
    request.headers.get("x-forwarded-for")?.slice(0, 100) ?? "unknown";
  await identityThrottle(tenant, `source:${path}:${source}`, 60, 20);
  if (path === "/is-username-available") {
    await identityThrottle(tenant, "username-availability-global", 60, 50);
    await identityThrottle(tenant, `username-availability:${source}`, 60, 5);
    const result = await pool.query(
      'SELECT 1 FROM tenant_users WHERE "tenantId"=$1 AND username=$2',
      [tenant.tenantId, usernameValue],
    );
    return jsonResponse({ available: result.rowCount === 0 });
  }
  const auth = getTenantAuth(tenant, origin, path === "/sign-in/username");
  const client = await getControlPool().connect();
  const lockKey = phone
    ? `identity-phone:${tenant.tenantId}:${phone}`
    : `identity-username:${tenant.tenantId}:${usernameValue}`;
  let locked = false;
  let signupLocked = false;
  const signupLockKey = `participant-signup:${tenant.tenantId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      lockKey,
    ]);
    locked = true;
    await identityThrottle(
      tenant,
      `${path}:${phone ?? usernameValue}`,
      60,
      path.endsWith("send-otp") ? 1 : 5,
    );
    let newUser = false;
    let signup: z.infer<typeof verifySchema> | undefined;
    let values: ReturnType<typeof validateProfileValues> | undefined;
    if (path === "/phone-number/verify") {
      signup = verifySchema.parse(input);
      if (signup.profile !== undefined) {
        try {
          values = validateProfileValues(
            settings.fields,
            { ...signup.profile, mobile: phone },
            "signup",
          );
        } catch {
          throw new DomainError(
            "VALIDATION_FAILED",
            "اطلاعات ثبت‌نام را کامل کنید.",
          );
        }
      }
      if (signup.updatePhoneNumber) {
        if (
          !settings.fields.find((field) => field.key === "mobile")?.userEditable
        )
          throw new DomainError("FORBIDDEN", "تغییر موبایل مجاز نیست.");
        const session = await auth.api.getSession({ headers: request.headers });
        if (
          !session ||
          (session.session as { tenantId?: string }).tenantId !==
            tenant.tenantId
        )
          throw new DomainError("UNAUTHENTICATED", "ورود لازم است.");
      } else {
        const existing = await pool.query(
          'SELECT 1 FROM tenant_users WHERE "tenantId"=$1 AND "phoneNumber"=$2',
          [tenant.tenantId, phone],
        );
        newUser = !existing.rowCount;
        if (newUser) {
          await client.query(
            "SELECT pg_advisory_lock(hashtextextended($1,0))",
            [signupLockKey],
          );
          signupLocked = true;
        }
      }
    }
    const body = {
      ...input,
      ...(phone ? { phoneNumber: phone } : {}),
      ...(usernameValue ? { username: usernameValue } : {}),
      ...(values ? { profile: values } : {}),
    };
    const authHeaders = new Headers(request.headers);
    authHeaders.set("x-request-id", requestId);
    authHeaders.delete("content-length");
    const response = await auth.handler(
      new Request(request.url, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      if (path === "/sign-in/username" && response.status === 401)
        await pool.query(
          `UPDATE tenant_users SET "failedLoginCount"="failedLoginCount"+1,"lockedUntil"=CASE WHEN "failedLoginCount"+1>=10 THEN now()+interval '15 minutes' ELSE "lockedUntil" END WHERE "tenantId"=$1 AND username=$2`,
          [tenant.tenantId, usernameValue],
        );
      logger.warn(
        { requestId, tenantId: tenant.tenantId, path, status: response.status },
        "Identity request rejected",
      );
      return jsonResponse(
        {
          message: path.endsWith("send-otp")
            ? "ارسال کد با مشکل مواجه شد. لطفاً کمی بعد دوباره تلاش کنید."
            : "اطلاعات ورود یا کد معتبر نیست یا منقضی شده است.",
        },
        { status: response.status, headers: { "x-request-id": requestId } },
      );
    }
    const payload = (await response.json()) as {
      user?: { id?: string; name?: string };
    };
    if (
      path === "/phone-number/verify" &&
      !newUser &&
      !signup?.updatePhoneNumber &&
      (signup?.password || signup?.username || signup?.profile)
    )
      throw new DomainError(
        "VALIDATION_FAILED",
        "برای تغییر پروفایل ابتدا وارد شوید.",
      );
    if (newUser && payload.user?.id && values) {
      await saveParticipantProfile(
        tenant,
        payload.user.id,
        values,
        "signup",
        requestId,
      );
      if (signup?.password && usernameValue)
        await pool.query(
          `INSERT INTO tenant_auth_accounts (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,'credential',$2,$3,now(),now())`,
          [
            randomUUID(),
            payload.user.id,
            await hashPlatformPassword(signup.password),
          ],
        );
    }
    if (path === "/sign-in/username" && payload.user?.id)
      await identityAudit(
        tenant,
        payload.user.id,
        "auth.username_login",
        requestId,
      );
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    return jsonResponse(
      {
        success: true,
        ...(payload.user
          ? { user: { id: payload.user.id, name: payload.user.name } }
          : {}),
      },
      { status: response.status, headers: responseHeaders },
    );
  } finally {
    if (signupLocked)
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        signupLockKey,
      ]);
    if (locked)
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        lockKey,
      ]);
    client.release();
  }
}
