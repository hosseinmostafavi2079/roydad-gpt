import { z } from "zod";
import {
  enrollForParticipant,
  listManagedEnrollments,
} from "@/modules/enrollment/repository";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const runId = new URL(request.url).searchParams.get("runId");
      if (runId) z.uuid().parse(runId);
      return listManagedEnrollments(
        { tenant, actor, requestId },
        runId || undefined,
      );
    },
    "enrollment.read",
    { feature: "registration" },
  );
}
const manualInput = z.strictObject({
  runId: z.uuid(),
  participantEmail: z.email().max(320),
  answers: z.record(z.string(), z.unknown()),
});
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(request, manualInput);
      return enrollForParticipant(
        { tenant, actor, requestId },
        input.runId,
        input.participantEmail,
        input.answers,
      );
    },
    "enrollment.manage",
    { feature: "registration", mutation: true },
  );
}
