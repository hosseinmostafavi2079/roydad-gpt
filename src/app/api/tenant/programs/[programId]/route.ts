import {
  getProgram,
  transitionProgram,
  updateProgram,
} from "@/modules/program-core/repository";
import { programInput, resourceId } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";
import { z } from "zod";

export const runtime = "nodejs";
type Context = { params: Promise<{ programId: string }> };
export function GET(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      getProgram(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).programId),
      ),
    "program.read",
    { feature: "courses" },
  );
}
export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateProgram(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).programId),
        await parseJson(request, programInput),
      ),
    "program.update",
    { mutation: true, feature: "courses" },
  );
}
const stateInput = z.strictObject({ state: z.enum(["ACTIVE", "ARCHIVED"]) });
export function PATCH(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      transitionProgram(
        { tenant, actor, requestId },
        resourceId.parse((await context.params).programId),
        (await parseJson(request, stateInput)).state,
      ),
    undefined,
    { mutation: true, feature: "courses" },
  );
}
