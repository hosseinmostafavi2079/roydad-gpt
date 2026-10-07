import { z } from "zod";
import { BackupRepository } from "@/modules/platform/backups/repository";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";
export const runtime = "nodejs";
export function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  return withPlatformAdminRoute(request, async () =>
    new BackupRepository().detail(z.uuid().parse((await context.params).jobId)),
  );
}
