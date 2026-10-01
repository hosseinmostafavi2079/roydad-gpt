import { z } from "zod";
import { startPaymentAttempt } from "@/modules/payments/service";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";
import { isE2eTestServer } from "@/shared/config/env";

export const runtime = "nodejs";

const schema = z.strictObject({
  enrollmentId: z.uuid(),
  providerKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  testScenario: z
    .enum([
      "SUCCESS",
      "FAILED",
      "PENDING",
      "INVALID_SIGNATURE",
      "AMOUNT_MISMATCH",
    ])
    .optional(),
});

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant, origin }, actor, requestId) => {
      const input = await parseJson(request, schema);
      if (
        input.testScenario &&
        (input.providerKey !== "TEST" || !isE2eTestServer())
      )
        throw new Error("Test payment scenarios are unavailable.");
      const callbackUrl = new URL(
        `${origin}/api/tenant/payments/callback/${input.providerKey}`,
      );
      if (input.testScenario)
        callbackUrl.searchParams.set("testScenario", input.testScenario);
      return startPaymentAttempt({
        tenant,
        actor,
        enrollmentId: input.enrollmentId,
        providerKey: input.providerKey,
        callbackUrl: callbackUrl.toString(),
        requestId,
      });
    },
    undefined,
    { mutation: true, feature: "payments" },
  );
}
