import { z } from "zod";
import {
  getRunRegistrationForm,
  updateRunRegistrationForm,
} from "@/modules/enrollment/form-repository";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };
const input = z.strictObject({ fields: z.array(z.unknown()).max(30) });
export async function GET(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const { runId } = await params;
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      getRunRegistrationForm(
        { tenant, actor, requestId },
        z.uuid().parse(runId),
      ),
    "program.update",
    { feature: "registration" },
  );
}
export async function PUT(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const { runId } = await params;
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      updateRunRegistrationForm(
        { tenant, actor, requestId },
        z.uuid().parse(runId),
        (await parseJson(request, input)).fields,
      ),
    "program.update",
    { feature: "registration", mutation: true },
  );
}
