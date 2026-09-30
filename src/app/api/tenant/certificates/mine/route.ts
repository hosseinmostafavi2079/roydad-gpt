import { listCertificates } from "@/modules/certificates/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    ({ tenant }, actor, requestId) =>
      listCertificates({ tenant, actor, requestId }, true),
    "certificate.self.read",
    { feature: "certificates" },
  );
}
