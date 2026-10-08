import { z } from "zod";
import { BackupRepository } from "@/modules/platform/backups/repository";
import {
  parseJson,
  withPlatformAdminRoute,
} from "@/shared/http/platform-route";

export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const id = z.uuid().parse((await context.params).jobId);
      await parseJson(request, z.strictObject({}));
      await new BackupRepository().requestDeletion(
        id,
        actor.adminId,
        requestId,
      );
      return new BackupRepository().detail(id);
    },
    { mutation: true },
  );
}
