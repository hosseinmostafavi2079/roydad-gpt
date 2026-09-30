import { z } from "zod";
import { getCertificatePdf } from "@/modules/certificates/repository";
import {
  requireTenantActor,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import { errorResponse, requestIdFrom } from "@/shared/http/api-response";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ certificateId: string }> },
): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const actor = await requireTenantActor(tenant, origin, request.headers);
    const { certificateId } = await context.params;
    const pdf = await getCertificatePdf(
      { tenant, actor, requestId },
      z.uuid().parse(certificateId),
    );
    return new Response(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="certificate-${certificateId}.pdf"`,
        "cache-control": "private, no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
