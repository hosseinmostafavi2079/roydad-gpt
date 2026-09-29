import {
  createTenantRole,
  listTenantRoles,
} from "@/modules/tenant-identity/repository";
import { authorize } from "@/modules/tenant-identity/permissions";
import { createTenantRoleSchema } from "@/modules/tenant-identity/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => listTenantRoles(tenant),
    "role.read",
  );
}

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = createTenantRoleSchema.parse(
        await parseJson(request, createTenantRoleSchema),
      );
      authorize(actor.permissions, "role.create");
      return createTenantRole(tenant, input, actor, requestId);
    },
    undefined,
    { mutation: true },
  );
}
