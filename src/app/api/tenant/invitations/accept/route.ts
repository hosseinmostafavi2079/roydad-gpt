import { createHash } from "node:crypto";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { acceptTenantInvitation } from "@/modules/tenant-identity/repository";
import { acceptTenantInvitationSchema } from "@/modules/tenant-identity/schema";
import {
  assertTenantSameOrigin,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import {
  parseJson,
  requestIdFrom,
  jsonResponse,
  errorResponse,
} from "@/shared/http/api-response";
import { DomainError } from "@/shared/errors/domain-error";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request);
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    assertTenantSameOrigin(request, origin);
    const input = await parseJson(request, acceptTenantInvitationSchema);
    const ipHint = process.env.TRUSTED_PROXY_CIDRS?.trim()
      ? (request.headers.get("x-real-ip") ?? "trusted-proxy-unknown")
      : "direct-client";
    const key = createHash("sha256")
      .update(`${tenant.tenantId}:${ipHint}`)
      .digest("hex");
    const rate = await getTenantPool(tenant).query<{ count: number }>(
      `INSERT INTO tenant_auth_rate_limits (key, count, "lastRequest")
       VALUES ($1, 1, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN tenant_auth_rate_limits."lastRequest" < floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 60000
           THEN 1 ELSE tenant_auth_rate_limits.count + 1 END,
         "lastRequest" = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
       RETURNING count`,
      [`invite-accept:${key}`],
    );
    if ((rate.rows[0]?.count ?? 0) > 10) {
      throw new DomainError(
        "RATE_LIMITED",
        "Too many activation attempts. Try again later.",
      );
    }
    await acceptTenantInvitation(
      tenant,
      input.token,
      input.password,
      requestId,
    );
    return jsonResponse(
      { data: { accepted: true }, requestId },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "VALIDATION_FAILED") {
      return jsonResponse(
        {
          error: {
            code: "INVITATION_INVALID",
            message: "The invitation is invalid or expired.",
            requestId,
          },
        },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }
    return errorResponse(error, request);
  }
}
