import {
  issueTenantUserInvitation,
  listTenantUsers,
} from "@/modules/tenant-identity/repository";
import { authorize } from "@/modules/tenant-identity/permissions";
import { inviteTenantUserSchema } from "@/modules/tenant-identity/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => listTenantUsers(tenant, "INSTRUCTOR"),
    "instructor.read",
    { feature: "crm" },
  );
}

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant, origin }, actor, requestId) => {
      const input = inviteTenantUserSchema.parse({
        ...(await parseJson(request, inviteTenantUserSchema)),
        profileType: "INSTRUCTOR",
      });
      authorize(actor.permissions, "instructor.create");
      return issueTenantUserInvitation(tenant, input, actor, requestId, origin);
    },
    undefined,
    { mutation: true, feature: "crm" },
  );
}
