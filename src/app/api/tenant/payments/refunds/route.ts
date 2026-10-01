import { z } from "zod";
import { refundPayment } from "@/modules/payments/refunds";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

const schema = z.strictObject({
  paymentId: z.uuid(),
  amount: z.string().regex(/^[1-9][0-9]{0,17}$/),
  method: z.enum(["PROVIDER", "MANUAL"]),
  reason: z.string().trim().min(1).max(500),
  reference: z.string().trim().min(1).max(255).optional(),
});

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(request, schema);
      return refundPayment(
        { tenant, actor, requestId },
        {
          paymentId: input.paymentId,
          method: input.method,
          reason: input.reason,
          ...(input.reference ? { reference: input.reference } : {}),
          amount: BigInt(input.amount),
        },
      );
    },
    "refund.manage",
    { mutation: true, feature: "payments" },
  );
}
