import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/shared/errors/domain-error";

const payloadSchema = z.strictObject({
  version: z.literal(1),
  tenantId: z.uuid(),
  sessionId: z.uuid(),
  challengeId: z.uuid(),
  expiresAt: z.number().int().positive(),
});

export type QrPayload = z.infer<typeof payloadSchema>;

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("eventos.attendance.qr.v1.")
    .update(encodedPayload)
    .digest();
}

export function signQrChallenge(payload: QrPayload, secret: string): string {
  const encoded = Buffer.from(
    JSON.stringify(payloadSchema.parse(payload)),
  ).toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifyQrChallenge(
  token: string,
  secret: string,
  expectedTenantId: string,
  now = new Date(),
): QrPayload {
  if (token.length > 1024)
    throw new DomainError("INVALID_QR", "کد حضور معتبر نیست.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new DomainError("INVALID_QR", "کد حضور معتبر نیست.");
  const actual = Buffer.from(parts[1], "base64url");
  const expected = signature(parts[0], secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new DomainError("INVALID_QR", "کد حضور معتبر نیست.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new DomainError("INVALID_QR", "کد حضور معتبر نیست.");
  }
  const payload = payloadSchema.safeParse(parsed);
  if (!payload.success)
    throw new DomainError("INVALID_QR", "کد حضور معتبر نیست.");
  if (payload.data.tenantId !== expectedTenantId)
    throw new DomainError("FORBIDDEN", "کد حضور متعلق به این مجموعه نیست.");
  if (payload.data.expiresAt <= Math.floor(now.getTime() / 1000))
    throw new DomainError("QR_EXPIRED", "اعتبار کد حضور به پایان رسیده است.");
  return payload.data;
}

export function checkInWindow(
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
): boolean {
  return (
    now.getTime() >= startsAt.getTime() - 60 * 60 * 1000 &&
    now.getTime() <= endsAt.getTime() + 30 * 60 * 1000
  );
}
