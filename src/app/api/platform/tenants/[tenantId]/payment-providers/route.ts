import { z } from "zod";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { setTenantPaymentProviderAllowed } from "@/modules/payments/platform-allowlist";
import { listPaymentProviders } from "@/modules/payments/registry";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };

const schema = z.strictObject({
  providerKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  allowed: z.boolean(),
});

export function GET(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(request, async () => {
    const { tenantId } = await context.params;
    const id = tenantIdSchema.parse(tenantId);
    const existing = await getControlPool().query<{
      provider_key: string;
      allowed: boolean;
    }>(
      "SELECT provider_key, allowed FROM tenant_payment_provider_allowlist WHERE tenant_id=$1",
      [id],
    );
    const permissions = new Map(
      existing.rows.map((row) => [row.provider_key, row.allowed]),
    );
    return listPaymentProviders().map((provider) => ({
      ...provider,
      allowed: permissions.get(provider.key) === true,
    }));
  });
}

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const { tenantId } = await context.params;
      const { providerKey, allowed } = await parseJson(request, schema);
      await setTenantPaymentProviderAllowed(
        tenantIdSchema.parse(tenantId),
        providerKey,
        allowed,
        actor,
        requestId,
      );
      return { providerKey, allowed };
    },
    { mutation: true },
  );
}
