import "server-only";

import type { PlatformActor } from "@/infrastructure/auth/platform-session";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { resolvePaymentProvider } from "./registry";

export async function setTenantPaymentProviderAllowed(
  tenantId: string,
  providerKey: string,
  allowed: boolean,
  actor: PlatformActor,
  requestId: string,
): Promise<void> {
  resolvePaymentProvider(providerKey);
  await withControlTransaction(async (client) => {
    const tenant = await client.query(
      "SELECT 1 FROM tenants WHERE id=$1 FOR UPDATE",
      [tenantId],
    );
    if (!tenant.rowCount) throw new Error("Tenant was not found.");
    await client.query(
      `INSERT INTO tenant_payment_provider_allowlist (tenant_id, provider_key, allowed, updated_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, provider_key) DO UPDATE
         SET allowed=EXCLUDED.allowed, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [tenantId, providerKey, allowed, actor.adminId],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "payment.provider_allowance_changed",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      afterState: { providerKey, allowed },
    });
  });
}
