import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { isProviderAllowed } from "@/modules/payments/configuration";
import { listPaymentProviders } from "@/modules/payments/registry";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => {
      const configured = await getTenantPool(tenant).query<{
        provider_key: string;
      }>(
        "SELECT provider_key FROM payment_provider_configs WHERE tenant_id=$1 AND enabled=true",
        [tenant.tenantId],
      );
      const enabled = new Set(configured.rows.map((row) => row.provider_key));
      const allowed = await Promise.all(
        listPaymentProviders()
          .filter((p) => enabled.has(p.key))
          .map(async (provider) => ({
            provider,
            allowed: await isProviderAllowed(tenant.tenantId, provider.key),
          })),
      );
      return allowed
        .filter(({ allowed }) => allowed)
        .map(({ provider }) => provider);
    },
    undefined,
    { feature: "payments" },
  );
}
