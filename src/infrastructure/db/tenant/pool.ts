import "server-only";

import { Pool } from "pg";
import { getServerConfig } from "@/shared/config/env";
import { logger } from "@/infrastructure/logging/logger";
import type { resolveTenantContext } from "@/modules/tenants/resolver";

export type TenantContext = Awaited<ReturnType<typeof resolveTenantContext>>;
export type TenantPoolContext = Pick<
  TenantContext,
  "tenantId" | "databaseName"
>;
type Entry = { databaseName: string; pool: Pool };
const pools = new Map<string, Entry>();

function databaseUrl(databaseName: string): string {
  if (!/^eventos_t_[0-9a-f]{32}$/.test(databaseName)) {
    throw new Error(
      "Tenant database registry contains an invalid database name.",
    );
  }
  const url = new URL(getServerConfig().TENANT_RUNTIME_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function dispose(pool: Pool, tenantId: string): void {
  void pool.end().catch((error: unknown) => {
    logger.warn(
      { tenantId, error: error instanceof Error ? error.name : "unknown" },
      "Could not dispose tenant database pool",
    );
  });
}

function makePool(context: TenantPoolContext): Pool {
  const config = getServerConfig();
  const pool = new Pool({
    connectionString: databaseUrl(context.databaseName),
    max: config.TENANT_POOL_CONNECTIONS_PER_DATABASE,
    idleTimeoutMillis: config.TENANT_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.TENANT_POOL_ACQUIRE_TIMEOUT_MS,
    application_name: `eventos-tenant-${context.tenantId.slice(0, 8)}`,
    allowExitOnIdle: config.NODE_ENV !== "production",
  });
  pool.on("error", (error) => {
    const code = "code" in error ? error.code : undefined;
    logger.error(
      { tenantId: context.tenantId, error: { name: error.name, code } },
      "Tenant database pool error",
    );
  });
  return pool;
}

export function getTenantPool(context: TenantPoolContext): Pool {
  const limit = getServerConfig().TENANT_POOL_LIMIT;
  const current = pools.get(context.tenantId);
  if (current && current.databaseName === context.databaseName) {
    pools.delete(context.tenantId);
    pools.set(context.tenantId, current);
    return current.pool;
  }
  if (current) {
    pools.delete(context.tenantId);
    dispose(current.pool, context.tenantId);
  }
  while (pools.size >= limit) {
    const oldest = pools.keys().next().value;
    if (oldest === undefined) break;
    const entry = pools.get(oldest);
    pools.delete(oldest);
    if (entry) dispose(entry.pool, oldest);
  }
  const pool = makePool(context);
  pools.set(context.tenantId, { databaseName: context.databaseName, pool });
  return pool;
}

export async function closeTenantPools(): Promise<void> {
  const active = [...pools.entries()];
  pools.clear();
  await Promise.all(active.map(([, entry]) => entry.pool.end()));
}

export function tenantPoolCacheSize(): number {
  return pools.size;
}
