import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { DomainError } from "@/shared/errors/domain-error";
import { requestLogger } from "@/infrastructure/logging/logger";
import { getServerConfig } from "@/shared/config/env";

export function requestIdFrom(request: Request): string {
  const forwarded = request.headers.get("x-request-id");
  return forwarded && /^[0-9a-f-]{36}$/i.test(forwarded)
    ? forwarded
    : randomUUID();
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(data, { ...init, headers });
}

export function errorResponse(
  error: unknown,
  request: Request,
  requestId = requestIdFrom(request),
): Response {
  if (error instanceof DomainError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message, requestId } },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return jsonResponse(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "The request contains invalid fields.",
          requestId,
          fields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  requestLogger(requestId).error(
    {
      error:
        error instanceof Error
          ? { name: error.name, code: "code" in error ? error.code : undefined }
          : "unknown",
    },
    "Request failed unexpectedly",
  );
  return jsonResponse(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId,
      },
    },
    { status: 500 },
  );
}

export async function parseJson<T>(
  request: Request,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > 65536
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Request body exceeds the allowed size.",
    );
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Content-Type must be application/json.",
    );
  }

  if (!request.body) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Request body must not be empty.",
    );
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 65536) {
        await reader.cancel();
        throw new DomainError(
          "VALIDATION_FAILED",
          "Request body exceeds the allowed size.",
        );
      }
      chunks.push(value);
    }
  } catch {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Request body must be valid JSON.",
    );
  } finally {
    reader.releaseLock();
  }

  let body: unknown;
  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Request body must be valid JSON.",
    );
  }

  return schema.parse(body);
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new DomainError(
      "FORBIDDEN",
      "An Origin header is required for this request.",
    );
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new DomainError(
      "FORBIDDEN",
      "Cross-origin requests are not allowed.",
    );
  }
  const configuredOrigin = new URL(getServerConfig().BETTER_AUTH_URL).origin;
  if (
    !["http:", "https:"].includes(parsedOrigin.protocol) ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    parsedOrigin.origin !== configuredOrigin
  ) {
    throw new DomainError(
      "FORBIDDEN",
      "Cross-origin requests are not allowed.",
    );
  }
}
