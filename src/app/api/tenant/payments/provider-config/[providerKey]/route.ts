import { z } from "zod";
import {
  saveProviderConfiguration,
  setProviderEnabled,
} from "@/modules/payments/configuration";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ providerKey: string }> };

const configSchema = z.strictObject({ config: z.unknown() });
const activationSchema = z.strictObject({ enabled: z.boolean() });

export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { providerKey } = await context.params;
      const { config } = await parseJson(request, configSchema);
      await saveProviderConfiguration(
        tenant,
        providerKey,
        config,
        actor,
        requestId,
      );
      return { configured: true, enabled: false };
    },
    "settings.manage",
    { mutation: true, feature: "payments" },
  );
}

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { providerKey } = await context.params;
      const { enabled } = await parseJson(request, activationSchema);
      await setProviderEnabled(tenant, providerKey, enabled, actor, requestId);
      return { enabled };
    },
    "settings.manage",
    { mutation: true, feature: "payments" },
  );
}
