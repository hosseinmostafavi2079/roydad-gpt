import "server-only";

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { getServerConfig } from "@/shared/config/env";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { logger } from "@/infrastructure/logging/logger";
import { sendPasswordResetEmail } from "@/infrastructure/auth/mailer";
import {
  hashPlatformPassword,
  verifyPlatformPassword,
} from "@/infrastructure/auth/password";

let authInstance: ReturnType<typeof betterAuth> | undefined;

export function getAuth() {
  if (authInstance) {
    return authInstance;
  }

  const config = getServerConfig();
  const trustedOrigins = new Set([config.BETTER_AUTH_URL]);
  const options: BetterAuthOptions = {
    appName: "EventOS",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [...trustedOrigins],
    database: getControlPool(),
    onAPIError: {
      onError: (error) => {
        logger.error(
          {
            module: "better-auth",
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "Authentication request failed",
        );
      },
    },
    user: { modelName: "platform_auth_users" },
    session: {
      modelName: "platform_auth_sessions",
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    account: { modelName: "platform_auth_accounts" },
    verification: {
      modelName: "platform_auth_verifications",
      storeIdentifier: "hashed",
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
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
        await sendPasswordResetEmail({ email: user.email, resetUrl: url });
      },
      onPasswordReset: async ({ user }) => {
        logger.info(
          { actorId: user.id, action: "platform_admin.password_reset" },
          "Platform administrator password reset",
        );
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "platform_auth_rate_limits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/forgot-password": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.NODE_ENV === "production",
      database: { generateId: "uuid", defaultFindManyLimit: 50 },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders: config.TRUSTED_PROXY_CIDRS.trim()
          ? ["x-real-ip"]
          : [],
        trustedProxies: config.TRUSTED_PROXY_CIDRS.split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    },
    plugins: config.PLATFORM_REQUIRE_MFA
      ? [
          twoFactor({
            issuer: "EventOS Platform",
            twoFactorTable: "platform_admin_two_factors",
            allowPasswordless: false,
          }),
        ]
      : [],
    logger: {
      disabled: false,
      log: (level, _message) => {
        const target =
          level === "error"
            ? logger.error
            : level === "warn"
              ? logger.warn
              : logger.info;
        target.call(logger, { module: "better-auth" }, "Authentication event");
      },
    },
  };
  const auth = betterAuth(options);

  authInstance = auth;
  return auth;
}
