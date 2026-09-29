import { createPlan, listPlans } from "@/modules/platform/plans/service";
import { createPlanSchema } from "@/modules/platform/plans/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withPlatformAdminRoute(request, async () => listPlans());
}

export function POST(request: Request): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) =>
      createPlan(await parseJson(request, createPlanSchema), actor, requestId),
    { mutation: true },
  );
}
