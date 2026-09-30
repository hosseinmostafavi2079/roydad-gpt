import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
export function GET(request: Request): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }) => {
      const result = await getTenantPool(tenant).query<{
        image_bytes: string;
        video_bytes: string;
      }>(
        `SELECT COALESCE(sum(size_bytes) FILTER (WHERE content_type LIKE 'image/%'),0)::text AS image_bytes,
              COALESCE(sum(size_bytes) FILTER (WHERE content_type='video/mp4'),0)::text AS video_bytes
       FROM tenant_media WHERE tenant_id=$1`,
        [tenant.tenantId],
      );
      const imageBytes = Number(result.rows[0]?.image_bytes ?? 0);
      const videoBytes = Number(result.rows[0]?.video_bytes ?? 0);
      return {
        imageBytes,
        videoBytes,
        totalBytes: imageBytes + videoBytes,
        limitBytes: tenant.limits.max_storage_mb * 1024 * 1024,
      };
    },
    "website.manage",
  );
}
