import { randomUUID } from "node:crypto";
import { resolveTenantRequest } from "@/modules/tenant-identity/request-auth";
import {
  locatePaymentAttemptForCallback,
  verifyPaymentAttempt,
} from "@/modules/payments/service";
import { resolvePaymentProvider } from "@/modules/payments/registry";
import { errorResponse } from "@/shared/http/api-response";

export const runtime = "nodejs";

async function handle(
  request: Request,
  providerKey: string,
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const url = new URL(request.url);
    let fields = Object.fromEntries(url.searchParams);
    if (request.method === "POST") {
      const contentType = request.headers.get("content-type") || "";
      const declaredLength = Number(
        request.headers.get("content-length") ?? "0",
      );
      if (!Number.isFinite(declaredLength) || declaredLength > 4096)
        throw new Error("Payment callback is too large.");
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > 4096)
        throw new Error("Payment callback is too large.");
      if (contentType.startsWith("application/x-www-form-urlencoded")) {
        fields = {
          ...fields,
          ...Object.fromEntries(
            new URLSearchParams(new TextDecoder().decode(body)),
          ),
        };
      } else {
        const parse = resolvePaymentProvider(providerKey).parseCallback;
        if (!parse) throw new Error("Unsupported payment callback format.");
        fields = {
          ...fields,
          ...parse({ headers: request.headers, body, query: fields }),
        };
      }
    }
    const attemptId = await locatePaymentAttemptForCallback(
      tenant,
      providerKey,
      fields,
    );
    const result = await verifyPaymentAttempt({
      tenant,
      attemptId,
      expectedProviderKey: providerKey,
      callback: fields,
      requestId,
    });
    if (request.method === "GET")
      return Response.redirect(
        new URL(`/account/payments/${result.paymentId}`, origin),
        303,
      );
    return Response.json(
      { data: result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ providerKey: string }> },
): Promise<Response> {
  const { providerKey } = await context.params;
  return handle(request, providerKey);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ providerKey: string }> },
): Promise<Response> {
  const { providerKey } = await context.params;
  return handle(request, providerKey);
}
