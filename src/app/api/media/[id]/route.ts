import { z } from "zod";
import { getMediaObject } from "@/infrastructure/media/s3";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import {
  resolveTenantRequest,
  requireTenantActor,
} from "@/modules/tenant-identity/request-auth";
import { type MediaRow } from "@/modules/media/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { errorResponse } from "@/shared/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const id = z.uuid().parse((await context.params).id);
    const row = await getTenantPool(tenant).query<
      MediaRow & { public_visible: boolean }
    >(
      `SELECT m.*, CASE WHEN m.purpose LIKE 'WEBSITE_%' THEN true
        ELSE EXISTS (SELECT 1 FROM programs p JOIN program_runs r ON r.tenant_id=p.tenant_id AND r.program_id=p.id
          WHERE p.tenant_id=m.tenant_id AND p.id=m.resource_id AND p.status='ACTIVE' AND r.state='PUBLISHED') END AS public_visible
       FROM tenant_media m WHERE m.tenant_id=$1 AND m.id=$2`,
      [tenant.tenantId, id],
    );
    const media = row.rows[0];
    if (!media) throw new DomainError("NOT_FOUND", "رسانه یافت نشد.");
    if (!media.public_visible) {
      const actor = await requireTenantActor(tenant, origin, request.headers);
      if (
        actor.tenantId !== tenant.tenantId ||
        !actor.permissions.has("program.read")
      )
        throw new DomainError("FORBIDDEN", "دسترسی به رسانه مجاز نیست.");
    }
    const size = Number(media.size_bytes);
    const requested = request.headers.get("range");
    const match = requested?.match(/^bytes=(\d+)-(\d*)$/);
    const start = match ? Number(match[1]) : 0;
    const end = match
      ? Math.min(match[2] ? Number(match[2]) : size - 1, size - 1)
      : size - 1;
    if (requested && (!match || start > end || start >= size))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    const bytes = await getMediaObject(
      media.object_key,
      match ? `bytes=${start}-${end}` : undefined,
    );
    return new Response(Buffer.from(bytes), {
      status: match ? 206 : 200,
      headers: {
        "Content-Type": media.content_type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
        ...(match ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
