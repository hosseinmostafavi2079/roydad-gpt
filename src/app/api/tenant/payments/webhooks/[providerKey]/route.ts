import { randomUUID } from "node:crypto";
import { processPaymentWebhook } from "@/modules/payments/service";
import { resolveTenantRequest } from "@/modules/tenant-identity/request-auth";
import { errorResponse } from "@/shared/http/api-response";

export const runtime = "nodejs";
type Context = { params: Promise<{ providerKey: string }> };

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const { tenant } = await resolveTenantRequest(request);
    const { providerKey } = await context.params;
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declaredLength) || declaredLength > 65536)
      throw new Error("Payment webhook is too large.");
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > 65536)
      throw new Error("Payment webhook is too large.");
    const result = await processPaymentWebhook({
      tenant,
      providerKey,
      headers: request.headers,
      body,
      requestId,
    });
    return Response.json(
      { data: result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
