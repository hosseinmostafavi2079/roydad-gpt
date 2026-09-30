import { z } from "zod";
import { revokeCertificate } from "@/modules/certificates/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ certificateId: string }> },
): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const { certificateId } = await context.params;
      return revokeCertificate(
        { tenant, actor, requestId },
        z.uuid().parse(certificateId),
      );
    },
    "certificate.revoke",
    { feature: "certificates", mutation: true },
  );
}
