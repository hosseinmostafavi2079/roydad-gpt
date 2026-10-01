import { z } from "zod";
import { applyCoupon } from "@/modules/payments/coupons";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

const schema = z.strictObject({
  enrollmentId: z.uuid(),
  code: z.string().min(3).max(64),
});

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(request, schema);
      return applyCoupon(
        { tenant, actor, requestId },
        input.enrollmentId,
        input.code,
      );
    },
    undefined,
    { mutation: true, feature: "payments" },
  );
}
