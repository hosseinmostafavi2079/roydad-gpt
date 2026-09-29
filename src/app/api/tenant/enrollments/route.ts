import { z } from "zod";
import {
  enrollParticipant,
  listOwnEnrollments,
} from "@/modules/enrollment/repository";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
const inputSchema = z.strictObject({
  runId: z.uuid(),
  answers: z.record(z.string(), z.unknown()),
});

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      listOwnEnrollments({ tenant, actor, requestId }),
    undefined,
    { feature: "registration" },
  );
}

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(request, inputSchema);
      return enrollParticipant(
        { tenant, actor, requestId },
        input.runId,
        input.answers,
      );
    },
    undefined,
    { mutation: true, feature: "registration" },
  );
}
