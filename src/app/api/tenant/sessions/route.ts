import { createSession, listSessions } from "@/modules/program-core/repository";
import { sessionInput } from "@/modules/program-core/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const query = new URL(request.url).searchParams;
      const start = query.get("start"),
        end = query.get("end");
      return listSessions(
        { tenant, actor, requestId },
        start ? new Date(start) : undefined,
        end ? new Date(end) : undefined,
      );
    },
    "session.read",
    { feature: "courses" },
  );
}
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      createSession(
        { tenant, actor, requestId },
        await parseJson(request, sessionInput),
      ),
    "session.manage",
    { mutation: true, feature: "courses" },
  );
}
