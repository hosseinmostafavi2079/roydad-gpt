import { assertPlatformActivationHost } from "@/modules/platform/admins/activation-host";
import { PlatformAdminRepository } from "@/modules/platform/admins/repository";
import { activateAdminSchema } from "@/modules/platform/admins/schema";
import {
  assertSameOrigin,
  errorResponse,
  jsonResponse,
  parseJson,
  requestIdFrom,
} from "@/shared/http/api-response";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    assertPlatformActivationHost(request.headers);
    assertSameOrigin(request);
    const result = await new PlatformAdminRepository().activatePlatformAdmin(
      await parseJson(request, activateAdminSchema),
      requestId,
    );
    return jsonResponse(
      { data: result },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
