import { z } from "zod";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";
import {
  getIdentitySettings,
  saveIdentitySettings,
  saveSmsConfiguration,
  identityThrottle,
  isSmsProviderAllowed,
  getSmsConfigurationView,
  reserveSmsBudget,
} from "@/modules/tenant-identity/identity-v2-repository";
import {
  loginMethodsSchema,
  profileFieldsSchema,
} from "@/modules/tenant-identity/identity-v2-schema";
import { smsProviderRegistry } from "@/modules/sms/registry";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { decryptSmsConfiguration } from "@/modules/tenant-identity/identity-v2-repository";
import { DomainError } from "@/shared/errors/domain-error";
import { normalizeIranianPhone } from "@/modules/tenant-identity/identity-v2-schema";
import { randomInt } from "node:crypto";

export function GET(request: Request) {
  return withTenantRoute(
    request,
    async ({ tenant }) => ({
      ...(await getIdentitySettings(tenant)),
      publicSmsConfig: await getSmsConfigurationView(tenant),
      providers: await Promise.all(
        smsProviderRegistry.list().map(async (provider) => ({
          ...provider,
          allowed: await isSmsProviderAllowed(tenant, provider.key),
        })),
      ),
    }),
    "settings.read",
  );
}
export function PUT(request: Request) {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(
        request,
        z.strictObject({
          methods: loginMethodsSchema,
          fields: profileFieldsSchema,
        }),
      );
      return saveIdentitySettings(tenant, actor.id, input, requestId);
    },
    "settings.manage",
    { mutation: true },
  );
}
export function POST(request: Request) {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(
        request,
        z.discriminatedUnion("action", [
          z.strictObject({
            action: z.literal("configure"),
            providerKey: z.string().max(40),
            config: z.unknown(),
          }),
          z.strictObject({
            action: z.literal("test"),
            phone: z.string().max(40),
          }),
        ]),
      );
      if (input.action === "configure")
        return saveSmsConfiguration(
          tenant,
          actor.id,
          input.providerKey,
          input.config,
          requestId,
        );
      await identityThrottle(tenant, `sms-config-test:${actor.id}`, 60, 1);
      const settings = await getIdentitySettings(tenant);
      if (
        !settings.providerKey ||
        !settings.configured ||
        !(await isSmsProviderAllowed(tenant, settings.providerKey))
      )
        throw new DomainError(
          "FEATURE_DISABLED",
          "ارائه‌دهنده پیکربندی نشده است.",
        );
      const result = await getTenantPool(tenant).query<{
        sms_config_ciphertext: Buffer;
      }>(
        "SELECT sms_config_ciphertext FROM tenant_identity_settings WHERE tenant_id=$1",
        [tenant.tenantId],
      );
      // This random code is a configuration probe, never a stored/accepted login OTP.
      await reserveSmsBudget(tenant);
      await smsProviderRegistry.resolve(settings.providerKey).sendOtp({
        config: decryptSmsConfiguration(
          tenant.tenantId,
          settings.providerKey,
          result.rows[0]?.sms_config_ciphertext ?? Buffer.alloc(0),
        ),
        phone: normalizeIranianPhone(input.phone),
        code: String(randomInt(100000, 1000000)),
        tenantId: tenant.tenantId,
        requestId,
      });
      return {
        success: true,
        message:
          "پیامک آزمایشی بررسی پیکربندی ارسال شد؛ کد آن برای ورود معتبر نیست.",
      };
    },
    "settings.manage",
    { mutation: true, feature: "sms" },
  );
}
