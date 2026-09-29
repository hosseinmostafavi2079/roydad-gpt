import {
  deleteTenantRole,
  updateTenantRole,
} from "@/modules/tenant-identity/repository";
import { authorize } from "@/modules/tenant-identity/permissions";
import {
  tenantRoleIdSchema,
  updateTenantRoleSchema,
} from "@/modules/tenant-identity/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ roleId: string }> };

export function PATCH(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const roleId = tenantRoleIdSchema.parse((await context.params).roleId);
      const input = updateTenantRoleSchema.parse(
        await parseJson(request, updateTenantRoleSchema),
      );
      authorize(actor.permissions, "role.update");
      return updateTenantRole(tenant, roleId, input, actor, requestId);
    },
    undefined,
    { mutation: true },
  );
}

export function DELETE(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const roleId = tenantRoleIdSchema.parse((await context.params).roleId);
      authorize(actor.permissions, "role.delete");
      await deleteTenantRole(tenant, roleId, actor, requestId);
      return { deleted: true };
    },
    undefined,
    { mutation: true },
  );
}
