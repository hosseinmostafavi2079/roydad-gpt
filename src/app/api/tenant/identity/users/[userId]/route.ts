import {
  updateTenantUserProfile,
  updateTenantUserStatus,
} from "@/modules/tenant-identity/repository";
import {
  tenantUserIdSchema,
  tenantUserUpdateSchema,
} from "@/modules/tenant-identity/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const userId = tenantUserIdSchema.parse((await context.params).userId);
      const input = tenantUserUpdateSchema.parse(
        await parseJson(request, tenantUserUpdateSchema),
      );
      if ("status" in input) {
        await updateTenantUserStatus(
          tenant,
          userId,
          input.status,
          actor,
          requestId,
        );
      } else {
        await updateTenantUserProfile(tenant, userId, input, actor, requestId);
      }
      return { updated: true };
    },
    undefined,
    { mutation: true },
  );
}
