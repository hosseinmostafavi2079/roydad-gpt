import { PlatformAdminRepository } from "@/modules/platform/admins/repository";
import {
  adminListSchema,
  createAdminSchema,
} from "@/modules/platform/admins/schema";
import {
  parseJson,
  parseQuery,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function GET(request: Request) {
  return withPlatformAdminRoute(request, async (actor) =>
    new PlatformAdminRepository().listPlatformAdmins(
      actor.adminId,
      parseQuery(request, adminListSchema).offset,
    ),
  );
}
export function POST(request: Request) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) =>
      new PlatformAdminRepository().createPlatformAdmin(
        await parseJson(request, createAdminSchema),
        actor.adminId,
        requestId,
      ),
    { mutation: true },
  );
}
