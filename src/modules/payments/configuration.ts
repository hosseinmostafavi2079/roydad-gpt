import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { getServerConfig } from "@/shared/config/env";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { resolvePaymentProvider } from "./registry";

function key(): Buffer {
  const config = getServerConfig();
  const material =
    config.TENANT_BOOTSTRAP_ENCRYPTION_KEY || config.BETTER_AUTH_SECRET;
  return createHash("sha256")
    .update("eventos-payment-provider-config-v1\0")
    .update(material)
    .digest();
}

function aad(tenantId: string, providerKey: string): Buffer {
  return Buffer.from(`${tenantId}:${providerKey}`);
}

export function encryptProviderConfig(
  tenantId: string,
  providerKey: string,
  value: unknown,
): Buffer {
  const parsed = resolvePaymentProvider(providerKey).configSchema.parse(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(tenantId, providerKey));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(parsed), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptProviderConfig(
  tenantId: string,
  providerKey: string,
  data: Buffer,
): unknown {
  if (!Buffer.isBuffer(data) || data.length < 29 || data.length > 8192)
    throw new Error("Payment provider configuration is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAAD(aad(tenantId, providerKey));
  decipher.setAuthTag(data.subarray(12, 28));
  const plaintext = Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  return resolvePaymentProvider(providerKey).configSchema.parse(
    JSON.parse(plaintext),
  );
}

export async function isProviderAllowed(
  tenantId: string,
  providerKey: string,
): Promise<boolean> {
  const result = await getControlPool().query<{ allowed: boolean }>(
    "SELECT allowed FROM tenant_payment_provider_allowlist WHERE tenant_id=$1 AND provider_key=$2",
    [tenantId, providerKey],
  );
  return result.rows[0]?.allowed === true;
}

export async function saveProviderConfiguration(
  tenant: TenantContext,
  providerKey: string,
  input: unknown,
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  if (actor.tenantId !== tenant.tenantId) throw new Error("Wrong tenant.");
  authorize(actor.permissions, "settings.manage");
  if (
    !tenant.features.payments ||
    !(await isProviderAllowed(tenant.tenantId, providerKey))
  )
    throw new Error("Payment provider is unavailable for this tenant.");
  const encrypted = encryptProviderConfig(tenant.tenantId, providerKey, input);
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO payment_provider_configs
       (tenant_id, provider_key, enabled, encrypted_config, updated_by)
     VALUES ($1,$2,false,$3,$4)
     ON CONFLICT (tenant_id, provider_key) DO UPDATE
       SET encrypted_config=EXCLUDED.encrypted_config, enabled=false,
           updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [tenant.tenantId, providerKey, encrypted, actor.id],
    );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id, actor_id, action, target_type, target_id, request_id, after_state)
       VALUES ($1,$2,'payment.provider_config_saved','PAYMENT_PROVIDER',$3,$4,'{"enabled":false}'::jsonb)`,
      [tenant.tenantId, actor.id, providerKey, requestId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function setProviderEnabled(
  tenant: TenantContext,
  providerKey: string,
  enabled: boolean,
  actor: TenantActor,
  requestId: string,
): Promise<void> {
  if (actor.tenantId !== tenant.tenantId) throw new Error("Wrong tenant.");
  authorize(actor.permissions, "settings.manage");
  resolvePaymentProvider(providerKey);
  if (
    enabled &&
    (!tenant.features.payments ||
      !(await isProviderAllowed(tenant.tenantId, providerKey)))
  )
    throw new Error("Payment provider is unavailable for this tenant.");
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE payment_provider_configs SET enabled=$3, updated_by=$4, updated_at=now()
       WHERE tenant_id=$1 AND provider_key=$2`,
      [tenant.tenantId, providerKey, enabled, actor.id],
    );
    if (!updated.rowCount)
      throw new Error("Payment provider is not configured.");
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id, actor_id, action, target_type, target_id, request_id, after_state)
       VALUES ($1,$2,'payment.provider_enabled','PAYMENT_PROVIDER',$3,$4,$5::jsonb)`,
      [
        tenant.tenantId,
        actor.id,
        providerKey,
        requestId,
        JSON.stringify({ enabled }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function loadActiveProviderConfiguration(
  tenant: TenantContext,
  providerKey: string,
): Promise<unknown> {
  if (
    !tenant.features.payments ||
    !(await isProviderAllowed(tenant.tenantId, providerKey))
  )
    throw new Error("Payment provider is unavailable for this tenant.");
  const result = await getTenantPool(tenant).query<{
    encrypted_config: Buffer;
  }>(
    `SELECT encrypted_config FROM payment_provider_configs
     WHERE tenant_id=$1 AND provider_key=$2 AND enabled=true`,
    [tenant.tenantId, providerKey],
  );
  if (!result.rows[0]) throw new Error("Payment provider is not configured.");
  return decryptProviderConfig(
    tenant.tenantId,
    providerKey,
    result.rows[0].encrypted_config,
  );
}
