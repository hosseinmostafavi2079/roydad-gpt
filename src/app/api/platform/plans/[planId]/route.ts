import { updatePlan } from "@/modules/platform/plans/service";
import { updatePlanSchema } from "@/modules/platform/plans/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
import { z } from "zod";
import { invalidateTenantResolutionCache } from "@/modules/tenants/resolver";

export const runtime = "nodejs";
type Context = { params: Promise<{ planId: string }> };

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const { planId } = await context.params;
      const result = await updatePlan(
        z.string().uuid().parse(planId),
        await parseJson(request, updatePlanSchema),
        actor,
        requestId,
      );
      invalidateTenantResolutionCache();
      return result;
    },
    { mutation: true },
  );
}
