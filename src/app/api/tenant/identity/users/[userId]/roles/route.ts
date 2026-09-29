import { assignTenantUserRoles } from "@/modules/tenant-identity/repository";
import { authorize } from "@/modules/tenant-identity/permissions";
import {
  assignTenantRolesSchema,
  tenantUserIdSchema,
} from "@/modules/tenant-identity/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const userId = tenantUserIdSchema.parse((await context.params).userId);
      const input = assignTenantRolesSchema.parse(
        await parseJson(request, assignTenantRolesSchema),
      );
      authorize(actor.permissions, "role.assign");
      await assignTenantUserRoles(
        tenant,
        userId,
        input.roleCodes,
        actor,
        requestId,
      );
      return { updated: true };
    },
    undefined,
    { mutation: true },
  );
}
