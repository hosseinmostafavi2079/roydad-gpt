import {
  issueCertificate,
  listCertificates,
} from "@/modules/certificates/repository";
import { issueInput } from "@/modules/certificates/schema";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    ({ tenant }, actor, requestId) =>
      listCertificates({ tenant, actor, requestId }),
    "certificate.read",
    { feature: "certificates" },
  );
}
export function POST(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      issueCertificate(
        { tenant, actor, requestId },
        await parseJson(request, issueInput),
      ),
    "certificate.issue",
    { feature: "certificates", mutation: true },
  );
}
