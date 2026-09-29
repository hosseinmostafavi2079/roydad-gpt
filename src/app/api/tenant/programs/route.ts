import { createProgram, listPrograms } from "@/modules/program-core/repository";
import { programInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const query = new URL(request.url).searchParams;
      return listPrograms(
        { tenant, actor, requestId },
        query.get("search") ?? "",
        query.get("type") ?? "",
        query.get("status") ?? "",
      );
    },
    "program.read",
    { feature: "courses" },
  );
}
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      createProgram(
        { tenant, actor, requestId },
        await parseJson(request, programInput),
      ),
    "program.create",
    { mutation: true, feature: "courses" },
  );
}
