import { getInvoiceForDownload } from "@/modules/payments/finance";
import { renderInvoicePdf } from "@/modules/payments/invoice-pdf";
import {
  requireTenantActor,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import { errorResponse, requestIdFrom } from "@/shared/http/api-response";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const actor = await requireTenantActor(tenant, origin, request.headers);
    const { invoiceId } = await context.params;
    const invoice = await getInvoiceForDownload({ tenant, actor }, invoiceId);
    const bytes = await renderInvoicePdf({
      invoiceNumber: invoice.invoice_number,
      issuedAt: invoice.issued_at,
      participantName: invoice.participant_name,
      runTitle: invoice.run_title,
      snapshot: invoice.snapshot,
    });
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
