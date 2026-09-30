import {
  errorResponse,
  jsonResponse,
  parseJson,
  requestIdFrom,
} from "@/shared/http/api-response";
import { DomainError } from "@/shared/errors/domain-error";
import { authorize } from "@/modules/tenant-identity/permissions";
import {
  assertTenantSameOrigin,
  requireTenantActor,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";

type TenantRouteOptions = Readonly<{
  mutation?: boolean;
  feature?: keyof Awaited<
    ReturnType<typeof resolveTenantRequest>
  >["tenant"]["features"];
}>;

export async function withTenantRoute<T>(
  request: Request,
  handler: (
    context: Awaited<ReturnType<typeof resolveTenantRequest>>,
    actor: Awaited<ReturnType<typeof requireTenantActor>>,
    requestId: string,
  ) => Promise<T>,
  requiredPermission?: string,
  options: TenantRouteOptions = {},
): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const context = await resolveTenantRequest(request);
    if (options.mutation) assertTenantSameOrigin(request, context.origin);
    const actor = await requireTenantActor(
      context.tenant,
      context.origin,
      request.headers,
    );
    if (options.feature && !context.tenant.features[options.feature]) {
      throw new DomainError(
        "FEATURE_DISABLED",
        "This feature is not enabled for the tenant.",
      );
    }
    if (requiredPermission) authorize(actor.permissions, requiredPermission);
    const result = await handler(context, actor, requestId);
    return jsonResponse(
      { data: result },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}

export { parseJson };
