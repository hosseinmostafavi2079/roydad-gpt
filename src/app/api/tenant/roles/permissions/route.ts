import { listTenantPermissions } from "@/modules/tenant-identity/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => listTenantPermissions(tenant),
    "role.read",
  );
}
