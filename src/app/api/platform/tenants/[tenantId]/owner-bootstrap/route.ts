import { withPlatformAdminRoute } from "@/shared/http/platform-route";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { claimInitialOwnerAccess } from "@/modules/tenant-identity/owner-bootstrap";
export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) =>
      claimInitialOwnerAccess(
        tenantIdSchema.parse((await context.params).tenantId),
        actor,
        requestId,
      ),
    { mutation: true },
  );
}
