import { BackupRepository } from "@/modules/platform/backups/repository";
import {
  manualBackupSchema,
  backupListSchema,
} from "@/modules/platform/backups/schema";
import {
  parseJson,
  parseQuery,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function POST(request: Request) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) =>
      new BackupRepository().enqueue(
        await parseJson(request, manualBackupSchema),
        actor.adminId,
        requestId,
      ),
    { mutation: true },
  );
}
export function GET(request: Request) {
  return withPlatformAdminRoute(request, async () => {
    const query = parseQuery(request, backupListSchema);
    return new BackupRepository().list(query.limit, query.offset);
  });
}
