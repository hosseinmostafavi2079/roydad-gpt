import {
  errorResponse,
  jsonResponse,
  parseJson,
  requestIdFrom,
  assertSameOrigin,
} from "@/shared/http/api-response";
import { requirePlatformAdmin } from "@/infrastructure/auth/platform-session";

type RouteOptions = Readonly<{ mutation?: boolean }>;

export async function withPlatformAdminRoute<T>(
  request: Request,
  handler: (
    actor: Awaited<ReturnType<typeof requirePlatformAdmin>>,
    requestId: string,
  ) => Promise<T>,
  options: RouteOptions = {},
): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    if (options.mutation) assertSameOrigin(request);
    const actor = await requirePlatformAdmin({
      requestHeaders: request.headers,
    });
    const result = await handler(actor, requestId);
    return jsonResponse(
      { data: result },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function parseQuery<T>(
  request: Request,
  schema: { parse(value: unknown): T },
): T {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

export { parseJson };
