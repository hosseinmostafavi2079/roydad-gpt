import { getControlPool } from "@/infrastructure/db/control/pool";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { tenantIdSchema } from "@/modules/platform/tenants/schema";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { savePlatformTenantLogo } from "@/modules/media/repository";
import { mediaKinds } from "@/modules/media/validation";
import { DomainError } from "@/shared/errors/domain-error";
import { withPlatformAdminRoute } from "@/shared/http/platform-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export function POST(request: Request, context: Context): Promise<Response> {
  return withPlatformAdminRoute(
    request,
    async (actor, requestId) => {
      const tenantId = tenantIdSchema.parse((await context.params).tenantId);
      const length = Number(request.headers.get("content-length"));
      if (!Number.isFinite(length) || length <= 0 || length > 6 * 1024 * 1024)
        throw new DomainError(
          "VALIDATION_FAILED",
          "اندازهٔ درخواست لوگو مجاز نیست.",
        );
      const result = await getControlPool().query<{ hostname: string }>(
        `SELECT domain.hostname FROM tenants AS tenant
       JOIN tenant_domains AS domain ON domain.tenant_id = tenant.id
         AND domain.is_primary AND domain.verified_at IS NOT NULL
       WHERE tenant.id = $1 AND tenant.status = 'ACTIVE'`,
        [tenantId],
      );
      const hostname = result.rows[0]?.hostname;
      if (!hostname)
        throw new DomainError("NOT_FOUND", "مجموعهٔ فعال پیدا نشد.");
      const tenant = await resolveTenantContext(hostname);
      if (tenant.tenantId !== tenantId)
        throw new DomainError("FORBIDDEN", "مجموعه نامعتبر است.");
      const form = await request.formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > mediaKinds.WEBSITE_LOGO.maxBytes
      )
        throw new DomainError("VALIDATION_FAILED", "لوگوی انتخابی معتبر نیست.");
      const saved = await savePlatformTenantLogo(
        tenant,
        file.type,
        new Uint8Array(await file.arrayBuffer()),
        requestId,
      );
      await withControlTransaction((client) =>
        appendAuditRecord(client, {
          actorType: "PLATFORM_ADMIN",
          actorId: actor.adminId,
          action: "tenant.logo_uploaded",
          targetType: "TENANT",
          targetId: tenantId,
          requestId,
          afterState: { mediaId: saved.id },
        }),
      );
      return saved;
    },
    { mutation: true },
  );
}
