import { PlatformAdminRepository } from "@/modules/platform/admins/repository";
import {
  adminIdSchema,
  emptyAdminActionSchema,
} from "@/modules/platform/admins/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      await parseJson(request, emptyAdminActionSchema);
      return new PlatformAdminRepository().regenerateActivation(
        adminIdSchema.parse((await context.params).adminId),
        actor.adminId,
        requestId,
      );
    },
    { mutation: true },
  );
}
