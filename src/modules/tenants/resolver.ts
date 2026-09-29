import "server-only";

import { getControlPool } from "@/infrastructure/db/control/pool";
import { DomainError } from "@/shared/errors/domain-error";
import { getServerConfig } from "@/shared/config/env";
import {
  featureSetSchema,
  limitSetSchema,
  type FeatureSet,
  type LimitSet,
} from "@/modules/platform/plans/schema";
import { normalizeHostHeader } from "@/modules/tenants/host";

const cacheLimit = 4096;
const cacheTtlMs = 15_000;
type TenantContext = Readonly<{
  tenantId: string;
  slug: string;
  hostname: string;
  status: "ACTIVE";
  databaseName: string;
  locale: string;
  timezone: string;
  features: FeatureSet;
  limits: LimitSet;
  branding: Readonly<{
    brandName: string;
    primaryColor: string;
    accentColor: string;
  }>;
}>;
type CacheEntry = { value: TenantContext; expiresAt: number };
const hostCache = new Map<string, CacheEntry>();

export function clearTenantResolutionCacheForTests(): void {
  hostCache.clear();
}

export function tenantResolutionCacheSize(): number {
  return hostCache.size;
}

export function invalidateTenantResolutionCache(tenantId?: string): void {
  if (!tenantId) {
    hostCache.clear();
    return;
  }
  for (const [hostname, entry] of hostCache) {
    if (entry.value.tenantId === tenantId) hostCache.delete(hostname);
  }
}

function cached(hostname: string): TenantContext | undefined {
  const entry = hostCache.get(hostname);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    hostCache.delete(hostname);
    return undefined;
  }
  hostCache.delete(hostname);
  hostCache.set(hostname, entry);
  return entry.value;
}

function remember(hostname: string, value: TenantContext): void {
  while (hostCache.size >= cacheLimit) {
    const oldest = hostCache.keys().next().value;
    if (oldest === undefined) break;
    hostCache.delete(oldest);
  }
  hostCache.set(hostname, { value, expiresAt: Date.now() + cacheTtlMs });
}

export async function resolveTenantContext(
  hostHeader: string,
): Promise<TenantContext> {
  const hostname = normalizeHostHeader(hostHeader);
  const hit = cached(hostname);
  if (hit) return hit;

  const config = getServerConfig();
  const baseDomain = config.PLATFORM_BASE_DOMAIN;
  if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
    const prefix =
      hostname === baseDomain
        ? ""
        : hostname.slice(0, -(baseDomain.length + 1));
    if (!prefix || prefix.includes("."))
      throw new DomainError(
        "NOT_FOUND",
        "No tenant is registered for this host.",
      );
  }

  const result = await getControlPool().query<{
    tenant_id: string;
    slug: string;
    hostname: string;
    domain_type: "PLATFORM_SUBDOMAIN" | "CUSTOM";
    verified_at: Date | null;
    status: string;
    database_name: string;
    migration_version: string | null;
    health_state: string;
    locale: string;
    timezone: string;
    plan_features: unknown;
    plan_limits: unknown;
    feature_overrides: unknown;
    limit_overrides: unknown;
    brand_name: string;
    primary_color: string;
    accent_color: string;
  }>(
    `SELECT tenant.id AS tenant_id, tenant.slug, domain.hostname, domain.domain_type, domain.verified_at,
            tenant.status, registry.database_name, registry.migration_version,
            registry.last_health_state AS health_state, tenant.locale, tenant.timezone,
            plan.features AS plan_features, plan.limits AS plan_limits,
            COALESCE((SELECT jsonb_object_agg(feature_key, enabled) FROM tenant_features WHERE tenant_id = tenant.id), '{}'::jsonb) AS feature_overrides,
            COALESCE((SELECT jsonb_object_agg(limit_key, limit_value) FROM tenant_limits WHERE tenant_id = tenant.id), '{}'::jsonb) AS limit_overrides,
            branding.brand_name, branding.primary_color, branding.accent_color
     FROM tenant_domains AS domain
     JOIN tenants AS tenant ON tenant.id = domain.tenant_id
     JOIN tenant_database_registry AS registry ON registry.tenant_id = tenant.id
     JOIN plans AS plan ON plan.id = tenant.plan_id
     JOIN tenant_branding AS branding ON branding.tenant_id = tenant.id
     WHERE domain.hostname = $1`,
    [hostname],
  );
  const row = result.rows[0];
  if (!row)
    throw new DomainError(
      "NOT_FOUND",
      "No tenant is registered for this host.",
    );
  if (row.domain_type === "CUSTOM" && !row.verified_at) {
    throw new DomainError(
      "DOMAIN_UNVERIFIED",
      "This domain has not completed verification.",
    );
  }
  if (row.status !== "ACTIVE" || !row.migration_version) {
    throw new DomainError("TENANT_NOT_ACTIVE", "This tenant is not available.");
  }
  if (!["HEALTHY", "DEGRADED"].includes(row.health_state)) {
    throw new DomainError("TENANT_NOT_ACTIVE", "This tenant is not available.");
  }
  const planFeatures = featureSetSchema.safeParse(row.plan_features);
  const planLimits = limitSetSchema.safeParse(row.plan_limits);
  if (!planFeatures.success || !planLimits.success)
    throw new Error("The tenant plan configuration is invalid.");
  const features = featureSetSchema.parse({
    ...planFeatures.data,
    ...(row.feature_overrides as object),
  });
  const limits = limitSetSchema.parse({
    ...planLimits.data,
    ...(row.limit_overrides as object),
  });
  const context: TenantContext = Object.freeze({
    tenantId: row.tenant_id,
    slug: row.slug,
    hostname,
    status: "ACTIVE",
    databaseName: row.database_name,
    locale: row.locale,
    timezone: row.timezone,
    features,
    limits,
    branding: Object.freeze({
      brandName: row.brand_name,
      primaryColor: row.primary_color,
      accentColor: row.accent_color,
    }),
  });
  remember(hostname, context);
  return context;
}
