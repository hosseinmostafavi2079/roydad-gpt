import { z } from "zod";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { getServerConfig } from "@/shared/config/env";
import {
  parseQuery,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";

export const runtime = "nodejs";

const querySchema = z.strictObject({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
});

export function GET(request: Request): Promise<Response> {
  return withPlatformAdminRoute(request, async () => {
    const { slug } = parseQuery(request, querySchema);
    const hostname = `${slug}.${getServerConfig().PLATFORM_BASE_DOMAIN}`;
    const result = await getControlPool().query<{ available: boolean }>(
      `SELECT NOT EXISTS (SELECT 1 FROM tenants WHERE slug = $1)
              AND NOT EXISTS (SELECT 1 FROM tenant_domains WHERE hostname = $2)
              AS available`,
      [slug, hostname],
    );
    return { available: Boolean(result.rows[0]?.available), hostname };
  });
}
