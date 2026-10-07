import { BackupRepository } from "@/modules/platform/backups/repository";
import { backupPolicySchema } from "@/modules/platform/backups/schema";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function GET(request: Request) {
  return withPlatformAdminRoute(request, async () =>
    new BackupRepository().policy(),
  );
}
export function PATCH(request: Request) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) =>
      new BackupRepository().updatePolicy(
        await parseJson(request, backupPolicySchema),
        actor.adminId,
        requestId,
      ),
    { mutation: true },
  );
}
