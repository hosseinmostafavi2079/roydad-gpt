import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerConfig } from "@/shared/config/env";

type MockIdentity = {
  tenantId: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  exp: number;
};

export function parseE2eGoogleIdentity(
  token: string,
  tenantId: string,
): MockIdentity | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || payload.length > 2048) return null;
  const expected = createHmac("sha256", getServerConfig().BETTER_AUTH_SECRET)
    .update(`e2e-google:${tenantId}:${payload}`)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as MockIdentity;
    if (
      value.tenantId !== tenantId ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email) ||
      typeof value.name !== "string" ||
      !value.name ||
      typeof value.sub !== "string" ||
      !value.sub ||
      typeof value.emailVerified !== "boolean" ||
      !Number.isFinite(value.exp) ||
      value.exp <= Date.now()
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
