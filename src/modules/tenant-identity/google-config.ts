import { isE2eTestServer } from "@/shared/config/env";

export function googleOAuthEnabledForOrigin(origin: string): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const configuredOrigins = process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS;
  if (!clientId || !clientSecret || !configuredOrigins) return false;
  if (googleMockEnabledForOrigin(origin)) return true;
  const allowed = configuredOrigins.split(",").map((value) => value.trim());
  return allowed.some((value) => value === origin);
}

export function googleMockEnabled(): boolean {
  return isE2eTestServer() && process.env.EVENTOS_E2E_GOOGLE_MOCK === "true";
}

export function googleMockEnabledForOrigin(origin: string): boolean {
  return (
    googleMockEnabled() && /^http:\/\/[a-z0-9-]+\.localhost:\d+$/.test(origin)
  );
}
