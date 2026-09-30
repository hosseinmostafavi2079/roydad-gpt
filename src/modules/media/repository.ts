import "server-only";

import { randomUUID } from "node:crypto";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { deleteMediaObject, putMediaObject } from "@/infrastructure/media/s3";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import { DomainError } from "@/shared/errors/domain-error";
import { mediaObjectKey, type MediaKind, validateMedia } from "./validation";

export type MediaRow = {
  id: string;
  purpose: MediaKind;
  resource_id: string;
  object_key: string;
  content_type: string;
  size_bytes: string;
};
export function mediaUrl(id: string): string {
  return `/api/media/${id}`;
}

function assertMediaAccess(
  tenant: TenantContext,
  actor: TenantActor,
  kind: MediaKind,
) {
  if (tenant.tenantId !== actor.tenantId)
    throw new DomainError("FORBIDDEN", "رسانه متعلق به این مجموعه نیست.");
  authorize(
    actor.permissions,
    kind.startsWith("PROGRAM_") ? "program.update" : "website.manage",
  );
}

export async function saveMedia(
  tenant: TenantContext,
  actor: TenantActor,
  kind: MediaKind,
  resourceId: string,
  mime: string,
  bytes: Uint8Array,
  requestId: string,
) {
  assertMediaAccess(tenant, actor, kind);
  validateMedia(kind, mime, bytes);
  const client = await getTenantPool(tenant).connect();
  const key = mediaObjectKey(tenant.tenantId, kind, resourceId, randomUUID());
  let uploaded = false;
  let oldKey: string | undefined;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT tenant_id FROM tenant_metadata WHERE tenant_id=$1 FOR UPDATE",
      [tenant.tenantId],
    );
    if (kind.startsWith("PROGRAM_")) {
      const program = await client.query(
        "SELECT 1 FROM programs WHERE tenant_id=$1 AND id=$2 AND status<>'ARCHIVED'",
        [tenant.tenantId, resourceId],
      );
      if (!program.rowCount)
        throw new DomainError("NOT_FOUND", "برنامه یافت نشد.");
    } else if (resourceId !== tenant.tenantId) {
      throw new DomainError("FORBIDDEN", "رسانه متعلق به این مجموعه نیست.");
    }
    const old = await client.query<MediaRow>(
      "SELECT * FROM tenant_media WHERE tenant_id=$1 AND purpose=$2 AND resource_id=$3 FOR UPDATE",
      [tenant.tenantId, kind, resourceId],
    );
    oldKey = old.rows[0]?.object_key;
    const usage = await client.query<{ total: string }>(
      "SELECT COALESCE(sum(size_bytes),0)::text AS total FROM tenant_media WHERE tenant_id=$1",
      [tenant.tenantId],
    );
    const projected =
      BigInt(usage.rows[0]?.total ?? "0") -
      BigInt(old.rows[0]?.size_bytes ?? "0") +
      BigInt(bytes.length);
    if (projected > BigInt(tenant.limits.max_storage_mb) * 1024n * 1024n)
      throw new DomainError(
        "TENANT_LIMIT_REACHED",
        "فضای ذخیره‌سازی مجموعه تکمیل شده است.",
      );
    await putMediaObject(key, mime, bytes);
    uploaded = true;
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `INSERT INTO tenant_media (tenant_id,id,purpose,resource_id,object_key,content_type,size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id,purpose,resource_id) DO UPDATE SET id=excluded.id,object_key=excluded.object_key,content_type=excluded.content_type,size_bytes=excluded.size_bytes,created_at=now()
       RETURNING id`,
      [tenant.tenantId, id, kind, resourceId, key, mime, bytes.length],
    );
    const savedId = result.rows[0]?.id;
    if (!savedId) throw new Error("Media row was not returned after upload.");
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1,$2,'media.uploaded','MEDIA',$3,$4)`,
      [tenant.tenantId, actor.id, savedId, requestId],
    );
    await client.query("COMMIT");
    if (oldKey) await deleteMediaObject(oldKey).catch(() => undefined);
    return {
      id: savedId,
      url: mediaUrl(savedId),
      sizeBytes: bytes.length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (uploaded) await deleteMediaObject(key).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function removeMedia(
  tenant: TenantContext,
  actor: TenantActor,
  kind: MediaKind,
  resourceId: string,
  requestId: string,
) {
  assertMediaAccess(tenant, actor, kind);
  if (!kind.startsWith("PROGRAM_") && resourceId !== tenant.tenantId)
    throw new DomainError("FORBIDDEN", "رسانه متعلق به این مجموعه نیست.");
  const pool = getTenantPool(tenant);
  const removed = await pool.query<MediaRow>(
    "DELETE FROM tenant_media WHERE tenant_id=$1 AND purpose=$2 AND resource_id=$3 RETURNING *",
    [tenant.tenantId, kind, resourceId],
  );
  if (removed.rows[0]) {
    await pool.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1,$2,'media.removed','MEDIA',$3,$4)`,
      [tenant.tenantId, actor.id, removed.rows[0].id, requestId],
    );
    await deleteMediaObject(removed.rows[0].object_key).catch(() => undefined);
  }
  return { removed: Boolean(removed.rows[0]) };
}
