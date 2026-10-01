import { z } from "zod";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { createCoupon } from "@/modules/payments/coupons";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

const schema = z.strictObject({
  code: z.string().min(3).max(64),
  discountType: z.enum(["FIXED", "PERCENT"]),
  discountValue: z.string().regex(/^[1-9][0-9]{0,17}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  maxUses: z.number().int().positive().max(1_000_000).nullable(),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => {
      const rows = await getTenantPool(tenant).query(
        `SELECT id,code,discount_type,discount_value,currency,max_uses,used_count,
         starts_at,ends_at,enabled,created_at FROM coupons
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [tenant.tenantId],
      );
      return rows.rows;
    },
    "payment.manage",
    { feature: "payments" },
  );
}

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(request, schema);
      return createCoupon(
        { tenant, actor, requestId },
        {
          code: input.code,
          discountType: input.discountType,
          discountValue: BigInt(input.discountValue),
          currency: input.currency,
          maxUses: input.maxUses,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
        },
      );
    },
    "payment.manage",
    { mutation: true, feature: "payments" },
  );
}
