import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

// CLI-only schema declaration: it intentionally avoids importing server-only runtime modules.
export const auth = betterAuth({
  appName: "EventOS",
  database: new Pool({ connectionString: process.env.CONTROL_DATABASE_URL }),
  user: { modelName: "platform_auth_users" },
  session: { modelName: "platform_auth_sessions" },
  account: { modelName: "platform_auth_accounts" },
  verification: {
    modelName: "platform_auth_verifications",
    storeIdentifier: "hashed",
  },
  rateLimit: { modelName: "platform_auth_rate_limits", storage: "database" },
  advanced: { database: { generateId: "uuid" } },
  plugins: [
    twoFactor({
      issuer: "EventOS Platform",
      twoFactorTable: "platform_admin_two_factors",
      allowPasswordless: false,
    }),
  ],
});
