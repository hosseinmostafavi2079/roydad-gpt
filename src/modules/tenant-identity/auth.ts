import "server-only";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { createHmac, randomUUID } from "node:crypto";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import {
  hashPlatformPassword,
  verifyPlatformPassword,
} from "@/infrastructure/auth/password";
import {
  sendTenantEmailOtp,
  sendTenantPasswordResetEmail,
  sendTenantVerificationEmail,
} from "@/infrastructure/auth/mailer";
import { logger } from "@/infrastructure/logging/logger";
import type { resolveTenantContext } from "@/modules/tenants/resolver";
import { getServerConfig } from "@/shared/config/env";
import { canAuthenticateTenantUser } from "@/modules/tenant-identity/policy";
import {
  googleOAuthEnabledForOrigin,
  googleMockEnabledForOrigin,
} from "@/modules/tenant-identity/google-config";
import { parseE2eGoogleIdentity } from "@/modules/tenant-identity/e2e-google";

export type TenantContext = Awaited<ReturnType<typeof resolveTenantContext>>;
const authCache = new Map<string, ReturnType<typeof betterAuth>>();

export function getTenantAuth(context: TenantContext, origin: string) {
  const googleEnabled =
    context.features.google_login && googleOAuthEnabledForOrigin(origin);
  const googleMock = googleMockEnabledForOrigin(origin);
  const key = `${context.tenantId}:${context.databaseName}:${origin}:${googleEnabled}`;
  const cached = authCache.get(key);
  if (cached) {
    authCache.delete(key);
    authCache.set(key, cached);
    return cached;
  }
  const pool = getTenantPool(context);
  const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const isGoogleRequest = (url: string | undefined) =>
    Boolean(url?.includes("/callback/google")) ||
    (googleMock && Boolean(url?.includes("/sign-in/social")));
  const options: BetterAuthOptions = {
    appName: context.branding.brandName,
    baseURL: origin,
    basePath: "/api/tenant-auth",
    secret: createHmac("sha256", getServerConfig().BETTER_AUTH_SECRET)
      .update(`tenant:${context.tenantId}`)
      .digest("hex"),
    trustedOrigins: [origin],
    database: pool,
    onAPIError: {
      onError: (error) => {
        logger.warn(
          {
            tenantId: context.tenantId,
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "Tenant authentication request failed",
        );
      },
    },
    logger: {
      disabled: false,
      log: (level, _message) => {
        const target =
          level === "error"
            ? logger.error
            : level === "warn"
              ? logger.warn
              : logger.info;
        target.call(
          logger,
          { module: "tenant-better-auth", tenantId: context.tenantId },
          "Tenant authentication event",
        );
      },
    },
    user: {
      modelName: "tenant_users",
      additionalFields: {
        tenantId: {
          type: "string",
          required: false,
          defaultValue: context.tenantId,
          input: false,
          returned: false,
        },
        status: {
          type: "string",
          required: true,
          defaultValue: "INVITED",
          input: false,
          returned: false,
        },
      },
    },
    session: {
      modelName: "tenant_auth_sessions",
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
      additionalFields: {
        tenantId: {
          type: "string",
          required: true,
          input: false,
        },
        authenticationLevel: {
          type: "string",
          required: true,
          defaultValue: "PASSWORD",
          input: false,
        },
      },
    },
    account: {
      modelName: "tenant_auth_accounts",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        trustedProviders: [],
      },
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            ...(googleMock
              ? {
                  verifyIdToken: async (token: string) =>
                    parseE2eGoogleIdentity(token, context.tenantId) !== null,
                  getUserInfo: async (tokens: {
                    idToken?: string | undefined;
                  }) => {
                    const identity = parseE2eGoogleIdentity(
                      tokens.idToken ?? "",
                      context.tenantId,
                    );
                    if (!identity) return null;
                    return {
                      user: {
                        name: identity.name,
                        email: identity.email,
                        image: undefined,
                        emailVerified: identity.emailVerified,
                      },
                      data: {
                        aud: googleClientId,
                        azp: googleClientId,
                        sub: identity.sub,
                        email: identity.email,
                        email_verified: identity.emailVerified,
                        exp: Math.floor(identity.exp / 1000),
                        family_name: "",
                        given_name: identity.name,
                        iat: Math.floor(Date.now() / 1000),
                        iss: "https://accounts.google.com",
                        name: identity.name,
                        nbf: Math.floor(Date.now() / 1000),
                        picture: "",
                      },
                    };
                  },
                }
              : {}),
          },
        }
      : {},
    verification: {
      modelName: "tenant_auth_verifications",
      storeIdentifier: "hashed",
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTenantVerificationEmail({
          email: user.email,
          url,
          tenantName: context.branding.brandName,
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      password: {
        hash: hashPlatformPassword,
        verify: ({ hash, password }) => verifyPlatformPassword(hash, password),
      },
      sendResetPassword: async ({ user, url }) => {
        await sendTenantPasswordResetEmail({
          email: user.email,
          resetUrl: url,
        });
      },
    },
    plugins: [
      emailOTP({
        disableSignUp: true,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        resendStrategy: "rotate",
        rateLimit: { window: 60, max: 3 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") throw new Error("Unsupported OTP purpose.");
          await sendTenantEmailOtp({
            email,
            otp,
            tenantName: context.branding.brandName,
          });
        },
      }),
    ],
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "tenant_auth_rate_limits",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      database: { generateId: "uuid", defaultFindManyLimit: 50 },
      cookiePrefix: "eventos-tenant",
      defaultCookieAttributes: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, hookContext) => {
            if (isGoogleRequest(hookContext?.request?.url)) {
              if (!context.features.registration) return false;
              const count = await pool.query<{ count: number }>(
                "SELECT count(*)::int AS count FROM tenant_participant_profiles WHERE tenant_id=$1",
                [context.tenantId],
              );
              if (
                (count.rows[0]?.count ?? 0) >= context.limits.max_participants
              )
                return false;
            }
            return {
              data: { ...user, tenantId: context.tenantId, status: "ACTIVE" },
            };
          },
          after: async (user, hookContext) => {
            if (!isGoogleRequest(hookContext?.request?.url)) return;
            await pool.query(
              `INSERT INTO tenant_participant_profiles (tenant_id,user_id,display_name)
               VALUES ($1,$2,$3) ON CONFLICT (tenant_id,user_id) DO NOTHING`,
              [context.tenantId, user.id, user.name],
            );
            await pool.query(
              `INSERT INTO tenant_user_roles (tenant_id,user_id,role_id)
               SELECT $1,$2,id FROM tenant_roles WHERE tenant_id=$1 AND code='participant'
               ON CONFLICT DO NOTHING`,
              [context.tenantId, user.id],
            );
          },
        },
      },
      session: {
        create: {
          before: async (session, hookContext) => {
            const user = await pool.query<{
              status: string;
              locked_until: Date | null;
            }>(
              `SELECT status, "lockedUntil" AS locked_until
               FROM tenant_users WHERE id = $1 AND "tenantId" = $2`,
              [session.userId, context.tenantId],
            );
            const row = user.rows[0];
            if (
              !row ||
              !canAuthenticateTenantUser(
                row.status as "ACTIVE" | "INVITED" | "SUSPENDED" | "DISABLED",
                row.locked_until,
              )
            ) {
              return false;
            }
            await pool.query(
              `UPDATE tenant_users SET "lastLoginAt" = now(), "failedLoginCount" = 0
               WHERE id = $1 AND "tenantId" = $2`,
              [session.userId, context.tenantId],
            );
            return {
              data: {
                ...session,
                tenantId: context.tenantId,
                authenticationLevel: hookContext?.request?.url.includes(
                  "/sign-in/email-otp",
                )
                  ? "EMAIL_OTP"
                  : isGoogleRequest(hookContext?.request?.url)
                    ? "GOOGLE"
                    : "PASSWORD",
              },
            };
          },
          after: async (session, hookContext) => {
            const requestId = hookContext?.request?.headers.get("x-request-id");
            await pool.query(
              `INSERT INTO tenant_audit_logs
                 (tenant_id, actor_id, action, target_type, target_id, request_id, after_state)
               VALUES ($1, $2, 'auth.signed_in', 'TENANT_USER', $2, $3, $4::jsonb)`,
              [
                context.tenantId,
                session.userId,
                requestId && /^[0-9a-f-]{36}$/i.test(requestId)
                  ? requestId
                  : randomUUID(),
                JSON.stringify({
                  authenticationLevel:
                    (session as { authenticationLevel?: string })
                      .authenticationLevel ?? "PASSWORD",
                }),
              ],
            );
          },
        },
      },
    },
  };
  const auth = betterAuth(options);
  authCache.set(key, auth);
  while (authCache.size > 128) {
    const oldest = authCache.keys().next().value;
    if (oldest === undefined) break;
    authCache.delete(oldest);
  }
  return auth;
}

export function clearTenantAuthCache(): void {
  authCache.clear();
}
