import { z } from "zod";
import {
  resolveTenantRequest,
  assertTenantSameOrigin,
} from "@/modules/tenant-identity/request-auth";
import { identityThrottle } from "@/modules/tenant-identity/identity-v2-repository";
import { activateInitialOwner } from "@/modules/tenant-identity/owner-bootstrap";
import {
  parseJson,
  requestIdFrom,
  jsonResponse,
  errorResponse,
} from "@/shared/http/api-response";
import { DomainError } from "@/shared/errors/domain-error";
import { normalizeUsername } from "@/modules/tenant-identity/identity-v2-schema";
export const runtime = "nodejs";
const schema = z.strictObject({
  username: z
    .string()
    .min(3)
    .max(30)
    .transform((value, ctx) => {
      try {
        return normalizeUsername(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "نام کاربری معتبر نیست." });
        return z.NEVER;
      }
    }),
  activationCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(12).max(128),
});
export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    assertTenantSameOrigin(request, origin);
    if (!tenant.features.password_login)
      throw new DomainError(
        "FEATURE_DISABLED",
        "ورود با نام کاربری فعال نیست.",
      );
    await identityThrottle(tenant, "initial-owner-activation", 60, 10);
    const input = await parseJson(request, schema);
    await activateInitialOwner(
      tenant,
      input.username,
      input.activationCode,
      input.password,
      requestId,
    );
    return jsonResponse({ data: { activated: true } });
  } catch (error) {
    return errorResponse(error, request, requestId);
  }
}
