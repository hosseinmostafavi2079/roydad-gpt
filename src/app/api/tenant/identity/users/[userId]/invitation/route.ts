import { revokeTenantUserInvitation } from "@/modules/tenant-identity/repository";
import { tenantUserIdSchema } from "@/modules/tenant-identity/schema";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export function POST(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const userId = tenantUserIdSchema.parse((await context.params).userId);
      await revokeTenantUserInvitation(tenant, userId, actor, requestId);
      return { revoked: true };
    },
    undefined,
    { mutation: true },
  );
}
