import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/infrastructure/auth/auth";
import { requestLogger } from "@/infrastructure/logging/logger";
import { jsonResponse, requestIdFrom } from "@/shared/http/api-response";
import { getServerConfig } from "@/shared/config/env";
import { assertEmailServiceAvailable } from "@/infrastructure/auth/mailer";
import { DomainError } from "@/shared/errors/domain-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleAuthRequest(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const configuredHost = new URL(
      getServerConfig().BETTER_AUTH_URL,
    ).host.toLowerCase();
    const requestHost = request.headers.get("host")?.toLowerCase();
    if (!requestHost || requestHost !== configuredHost) {
      return jsonResponse(
        {
          error: {
            code: "NOT_FOUND",
            message: "Authentication endpoint not found.",
            requestId,
          },
        },
        { status: 404 },
      );
    }
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
    if (
      [
        "/forget-password",
        "/forgot-password",
        "/request-password-reset",
        "/reset-password",
        "/send-verification-email",
        "/verify-email",
      ].includes(path) ||
      path.startsWith("/reset-password/") ||
      path.includes("email-otp")
    )
      assertEmailServiceAvailable();
    const handlers = toNextJsHandler(getAuth());
    return await (request.method === "GET" ? handlers.GET : handlers.POST)(
      request,
    );
  } catch (error) {
    if (error instanceof DomainError)
      return jsonResponse(
        { error: { code: error.code, message: error.message, requestId } },
        { status: error.status },
      );
    requestLogger(requestId).error(
      {
        module: "auth",
        errorType: error instanceof Error ? error.name : typeof error,
      },
      "Authentication request failed unexpectedly",
    );
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Authentication could not be completed.",
          requestId,
        },
      },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}
