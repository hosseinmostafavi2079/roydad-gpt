import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { getServerConfig } from "@/shared/config/env";

const ownerBootstrapSchema = z.strictObject({
  name: z.string().min(2).max(120),
  email: z.string().email().max(320),
});

function bootstrapKey(): Buffer {
  const config = getServerConfig();
  const keyMaterial =
    config.TENANT_BOOTSTRAP_ENCRYPTION_KEY || config.BETTER_AUTH_SECRET;
  return createHash("sha256")
    .update("eventos-tenant-owner-bootstrap-v1\0")
    .update(keyMaterial)
    .digest();
}

export function encryptTenantOwnerBootstrap(
  tenantId: string,
  input: { name: string; email: string },
): Buffer {
  const owner = ownerBootstrapSchema.parse(input);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bootstrapKey(), nonce);
  cipher.setAAD(Buffer.from(tenantId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(owner), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function decryptTenantOwnerBootstrap(
  tenantId: string,
  value: Buffer,
): {
  name: string;
  email: string;
} {
  if (!Buffer.isBuffer(value) || value.length < 29 || value.length > 2048) {
    throw new Error("Tenant owner bootstrap data is invalid.");
  }
  const nonce = value.subarray(0, 12);
  const tag = value.subarray(12, 28);
  const ciphertext = value.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", bootstrapKey(), nonce);
  decipher.setAAD(Buffer.from(tenantId));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return ownerBootstrapSchema.parse(JSON.parse(plaintext));
}
