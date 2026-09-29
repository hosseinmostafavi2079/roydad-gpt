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
    async ({ tenant }) => listTenantUsers(tenant, "PARTICIPANT"),
    "participant.read",
    { feature: "crm" },
  );
}

export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant, origin }, actor, requestId) => {
      const input = inviteTenantUserSchema.parse({
        ...(await parseJson(request, inviteTenantUserSchema)),
        profileType: "PARTICIPANT",
      });
      authorize(actor.permissions, "participant.create");
      return issueTenantUserInvitation(tenant, input, actor, requestId, origin);
    },
    undefined,
    { mutation: true, feature: "crm" },
  );
}
