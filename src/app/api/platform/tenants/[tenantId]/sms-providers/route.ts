import { z } from "zod";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { smsProviderRegistry } from "@/modules/sms/registry";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
type Context = { params: Promise<{ tenantId: string }> };
export function GET(request: Request, context: Context) {
  return withPlatformAdminRoute(request, async () => {
    const id = tenantIdSchema.parse((await context.params).tenantId);
    const result = await getControlPool().query<{
      provider_key: string;
      allowed: boolean;
    }>(
      "SELECT provider_key,allowed FROM tenant_sms_provider_allowlist WHERE tenant_id=$1",
      [id],
    );
    return smsProviderRegistry.list().map((provider) => ({
      ...provider,
      allowed: result.rows.some(
        (row) => row.provider_key === provider.key && row.allowed,
      ),
    }));
  });
}
export function PATCH(request: Request, context: Context) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const id = tenantIdSchema.parse((await context.params).tenantId);
      const input = await parseJson(
        request,
        z.strictObject({
          providerKey: z.string().max(40),
          allowed: z.boolean(),
        }),
      );
      if (
        !smsProviderRegistry
          .list()
          .some((provider) => provider.key === input.providerKey)
      )
        throw new Error("Unsupported SMS provider");
      await withControlTransaction(async (client) => {
        await client.query(
          `INSERT INTO tenant_sms_provider_allowlist (tenant_id,provider_key,allowed,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,provider_key) DO UPDATE SET allowed=EXCLUDED.allowed,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [id, input.providerKey, input.allowed, actor.adminId],
        );
        await appendAuditRecord(client, {
          actorType: "PLATFORM_ADMIN",
          actorId: actor.adminId,
          action: "sms.provider_allowance_changed",
          targetType: "TENANT",
          targetId: id,
          requestId,
          afterState: {
            providerKey: input.providerKey,
            allowed: input.allowed,
          },
        });
      });
      return input;
    },
    { mutation: true },
  );
}
