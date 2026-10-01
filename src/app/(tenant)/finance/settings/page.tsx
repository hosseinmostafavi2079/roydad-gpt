import { FinanceProviderActions } from "@/app/_components/finance-provider-actions";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { isProviderAllowed } from "@/modules/payments/configuration";
import { listPaymentProviders } from "@/modules/payments/registry";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function FinanceSettingsPage() {
  const { tenant, actor } = await requireTenantPage("finance.read");
  const installed = listPaymentProviders();
  const providers = (
    await Promise.all(
      installed.map(async (provider) => ({
        ...provider,
        allowed: await isProviderAllowed(tenant.tenantId, provider.key),
      })),
    )
  ).filter((provider) => provider.allowed);
  const configs = await getTenantPool(tenant).query<{
    provider_key: string;
    enabled: boolean;
  }>(
    "SELECT provider_key,enabled FROM payment_provider_configs WHERE tenant_id=$1",
    [tenant.tenantId],
  );
  const configured = new Map(
    configs.rows.map((row) => [row.provider_key, row.enabled]),
  );
  return (
    <section className="public-section">
      <h2>تنظیمات پرداخت</h2>
      <p>
        فقط درگاه‌های مجازشده توسط مدیر پلتفرم قابل تنظیم هستند. اطلاعات محرمانه
        نمایش داده نمی‌شوند.
      </p>
      {providers.map((provider) => (
        <article key={provider.key} className="public-run-card public-run-body">
          <h3>{provider.displayName}</h3>
          <p>
            {configured.has(provider.key)
              ? configured.get(provider.key)
                ? "فعال"
                : "تنظیم‌شده و غیرفعال"
              : "تنظیم‌نشده"}
          </p>
          {provider.key === "TEST" && (
            <p>این درگاه فقط برای توسعه محلی و CI است.</p>
          )}
          {actor.permissions.has("settings.manage") && (
            <FinanceProviderActions
              providerKey={provider.key}
              configured={configured.has(provider.key)}
              enabled={configured.get(provider.key) === true}
            />
          )}
        </article>
      ))}
      {!providers.length && (
        <p>درگاه پرداخت مجازی برای این مجموعه در دسترس نیست.</p>
      )}
    </section>
  );
}
