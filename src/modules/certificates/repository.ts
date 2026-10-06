import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import {
  deleteMediaObject,
  getMediaObject,
  putMediaObject,
} from "@/infrastructure/media/storage";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { getServerConfig } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { renderCertificatePdf } from "./pdf";
import {
  templateFields,
  validateTemplateMessage,
  type TemplateInput,
} from "./schema";

type Scope = { tenant: TenantContext; actor: TenantActor; requestId: string };
type TemplateRow = {
  id: string;
  name: string;
  fields_config: unknown;
  background_object_key: string | null;
  background_size_bytes: string;
};
type CertificateRow = {
  id: string;
  participant_id: string;
  program_id: string;
  run_id: string;
  serial_number: string;
  verification_code: string;
  issued_at: Date;
  status: string;
  revoked_at: Date | null;
  pdf_object_key: string;
  pdf_size_bytes: string;
  participant_name: string;
  program_name: string;
};

function permit(scope: Scope, permission: string) {
  if (scope.tenant.tenantId !== scope.actor.tenantId)
    throw new DomainError("FORBIDDEN", "گواهی متعلق به این مجموعه نیست.");
  if (!scope.tenant.features.certificates)
    throw new DomainError("FEATURE_DISABLED", "گواهی فعال نیست.");
  authorize(scope.actor.permissions, permission);
}
async function audit(
  client: PoolClient,
  scope: Scope,
  action: string,
  id: string,
) {
  await client.query(
    `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1,$2,$3,'CERTIFICATE',$4,$5)`,
    [scope.tenant.tenantId, scope.actor.id, action, id, scope.requestId],
  );
}
async function storageUsage(
  client: PoolClient,
  tenantId: string,
): Promise<bigint> {
  const result = await client.query<{ bytes: string }>(
    `SELECT (
    (SELECT COALESCE(sum(size_bytes),0) FROM tenant_media WHERE tenant_id=$1) +
    (SELECT COALESCE(sum(background_size_bytes),0) FROM certificate_templates WHERE tenant_id=$1) +
    (SELECT COALESCE(sum(pdf_size_bytes),0) FROM certificates WHERE tenant_id=$1))::text AS bytes`,
    [tenantId],
  );
  return BigInt(result.rows[0]?.bytes ?? "0");
}
function checkStorage(scope: Scope, projected: bigint) {
  if (projected > BigInt(scope.tenant.limits.max_storage_mb) * 1024n * 1024n)
    throw new DomainError(
      "TENANT_LIMIT_REACHED",
      "فضای ذخیره‌سازی مجموعه تکمیل شده است.",
    );
}

export async function listTemplates(scope: Scope) {
  permit(
    scope,
    scope.actor.permissions.has("certificate.template.manage")
      ? "certificate.template.manage"
      : "certificate.issue",
  );
  const result = await getTenantPool(scope.tenant).query(
    `SELECT id,name,fields_config,background_object_key,created_at,updated_at FROM certificate_templates WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [scope.tenant.tenantId],
  );
  return result.rows;
}

export async function listIssueCandidates(scope: Scope) {
  permit(scope, "certificate.issue");
  const result = await getTenantPool(scope.tenant).query<{
    run_id: string;
    run_title: string;
    participant_id: string;
    participant_name: string;
  }>(
    `SELECT r.id AS run_id,r.title AS run_title,e.participant_id,COALESCE(profile.display_name,u.name) AS participant_name
    FROM program_runs r JOIN enrollments e ON e.tenant_id=r.tenant_id AND e.run_id=r.id AND e.status IN ('CONFIRMED','COMPLETED')
    JOIN tenant_participant_profiles profile ON profile.tenant_id=e.tenant_id AND profile.user_id=e.participant_id
    JOIN tenant_users u ON u."tenantId"=profile.tenant_id AND u.id=profile.user_id
    WHERE r.tenant_id=$1 AND r.state='COMPLETED' ORDER BY r.ends_at DESC LIMIT 500`,
    [scope.tenant.tenantId],
  );
  return result.rows;
}

export async function saveTemplate(
  scope: Scope,
  input: TemplateInput,
  templateId?: string,
) {
  permit(scope, "certificate.template.manage");
  try {
    validateTemplateMessage(input.fields.message);
  } catch {
    throw new DomainError(
      "VALIDATION_FAILED",
      "متن گواهی دارای جایگزین ناشناخته است.",
    );
  }
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const result = templateId
      ? await client.query<{ id: string }>(
          `UPDATE certificate_templates SET name=$3,fields_config=$4::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id`,
          [
            scope.tenant.tenantId,
            templateId,
            input.name,
            JSON.stringify(input.fields),
          ],
        )
      : await client.query<{ id: string }>(
          `INSERT INTO certificate_templates (tenant_id,name,fields_config,created_by_user_id) VALUES ($1,$2,$3::jsonb,$4) RETURNING id`,
          [
            scope.tenant.tenantId,
            input.name,
            JSON.stringify(input.fields),
            scope.actor.id,
          ],
        );
    const id = result.rows[0]?.id;
    if (!id) throw new DomainError("NOT_FOUND", "قالب یافت نشد.");
    await audit(
      client,
      scope,
      templateId
        ? "certificate.template.updated"
        : "certificate.template.created",
      id,
    );
    await client.query("COMMIT");
    return { id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23505"
    )
      throw new DomainError("CONFLICT", "نام قالب تکراری است.");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveTemplateBackground(
  scope: Scope,
  templateId: string,
  mime: string,
  bytes: Uint8Array,
) {
  permit(scope, "certificate.template.manage");
  const isPng =
    mime === "image/png" &&
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  const isJpeg =
    mime === "image/jpeg" &&
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  if ((!isPng && !isJpeg) || bytes.length > 5 * 1024 * 1024)
    throw new DomainError(
      "VALIDATION_FAILED",
      "تصویر پس‌زمینه باید PNG یا JPEG و کمتر از ۵ مگابایت باشد.",
    );
  const key = `tenants/${scope.tenant.tenantId}/certificate-templates/${templateId}/${randomUUID()}`;
  const client = await getTenantPool(scope.tenant).connect();
  let uploaded = false;
  let oldKey: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT tenant_id FROM tenant_metadata WHERE tenant_id=$1 FOR UPDATE",
      [scope.tenant.tenantId],
    );
    const current = await client.query<TemplateRow>(
      `SELECT * FROM certificate_templates WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [scope.tenant.tenantId, templateId],
    );
    const row = current.rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "قالب یافت نشد.");
    oldKey = row.background_object_key;
    checkStorage(
      scope,
      (await storageUsage(client, scope.tenant.tenantId)) -
        BigInt(row.background_size_bytes) +
        BigInt(bytes.length),
    );
    await putMediaObject(key, mime, bytes);
    uploaded = true;
    await client.query(
      `UPDATE certificate_templates SET background_object_key=$3,background_size_bytes=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [scope.tenant.tenantId, templateId, key, bytes.length],
    );
    await audit(
      client,
      scope,
      "certificate.template.background_updated",
      templateId,
    );
    await client.query("COMMIT");
    if (oldKey) await deleteMediaObject(oldKey).catch(() => undefined);
    return { id: templateId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (uploaded) await deleteMediaObject(key).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function issueCertificate(
  scope: Scope,
  input: { runId: string; participantId: string; templateId: string },
) {
  permit(scope, "certificate.issue");
  const client = await getTenantPool(scope.tenant).connect();
  const id = randomUUID();
  const serial = `EV-${randomBytes(12).toString("hex").toUpperCase()}`;
  const code = randomBytes(24).toString("base64url");
  const key = `tenants/${scope.tenant.tenantId}/certificates/${id}.pdf`;
  let uploaded = false;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT tenant_id FROM tenant_metadata WHERE tenant_id=$1 FOR UPDATE",
      [scope.tenant.tenantId],
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM certificates WHERE tenant_id=$1 AND run_id=$2 AND participant_id=$3`,
      [scope.tenant.tenantId, input.runId, input.participantId],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { id: existing.rows[0].id, alreadyIssued: true };
    }
    const eligible = await client.query<{
      program_id: string;
      program_name: string;
      participant_name: string;
      instructor_name: string;
    }>(
      `SELECT r.program_id,p.title AS program_name,COALESCE(profile.display_name,u.name) AS participant_name,
      COALESCE((SELECT string_agg(i.display_name, '، ' ORDER BY i.display_name) FROM run_instructors ri JOIN tenant_instructor_profiles i ON i.tenant_id=ri.tenant_id AND i.user_id=ri.instructor_id WHERE ri.tenant_id=r.tenant_id AND ri.run_id=r.id),'') AS instructor_name
      FROM program_runs r JOIN programs p ON p.tenant_id=r.tenant_id AND p.id=r.program_id
      JOIN enrollments e ON e.tenant_id=r.tenant_id AND e.run_id=r.id AND e.participant_id=$3 AND e.status IN ('CONFIRMED','COMPLETED')
      JOIN tenant_participant_profiles profile ON profile.tenant_id=e.tenant_id AND profile.user_id=e.participant_id
      JOIN tenant_users u ON u."tenantId"=profile.tenant_id AND u.id=profile.user_id
      WHERE r.tenant_id=$1 AND r.id=$2 AND r.state='COMPLETED'`,
      [scope.tenant.tenantId, input.runId, input.participantId],
    );
    const subject = eligible.rows[0];
    if (!subject)
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "گواهی فقط برای اجرای تکمیل‌شده و ثبت‌نام معتبر صادر می‌شود.",
      );
    const template = await client.query<TemplateRow>(
      `SELECT * FROM certificate_templates WHERE tenant_id=$1 AND id=$2`,
      [scope.tenant.tenantId, input.templateId],
    );
    const design = template.rows[0];
    if (!design) throw new DomainError("NOT_FOUND", "قالب یافت نشد.");
    const background = design.background_object_key
      ? await getMediaObject(design.background_object_key)
      : undefined;
    const fields = templateFields.parse(design.fields_config);
    const logoRow = fields.showOrganizationLogo
      ? await client.query<{ object_key: string }>(
          `SELECT object_key FROM tenant_media WHERE tenant_id=$1 AND purpose='WEBSITE_LOGO' AND content_type IN ('image/png','image/jpeg') LIMIT 1`,
          [scope.tenant.tenantId],
        )
      : null;
    const logoKey = logoRow?.rows[0]?.object_key;
    const logo = logoKey ? await getMediaObject(logoKey) : undefined;
    const issuedAt = new Date();
    const baseUrl = new URL(getServerConfig().BETTER_AUTH_URL);
    const local = getServerConfig().PLATFORM_BASE_DOMAIN === "localhost";
    const verificationUrl = local
      ? `${baseUrl.protocol}//${scope.tenant.hostname}${baseUrl.port ? `:${baseUrl.port}` : ""}/certificate/${code}`
      : `https://${scope.tenant.hostname}/certificate/${code}`;
    const pdf = await renderCertificatePdf({
      participantName: subject.participant_name,
      programName: subject.program_name,
      instructorName: subject.instructor_name,
      organizationName: scope.tenant.branding.brandName,
      issuedAt,
      serialNumber: serial,
      fields,
      ...(background ? { background } : {}),
      ...(logo ? { logo } : {}),
      verificationUrl,
    });
    checkStorage(
      scope,
      (await storageUsage(client, scope.tenant.tenantId)) + BigInt(pdf.length),
    );
    await putMediaObject(key, "application/pdf", pdf);
    uploaded = true;
    await client.query(
      `INSERT INTO certificates (tenant_id,id,participant_id,program_id,run_id,template_id,serial_number,verification_code,issued_at,issued_by_user_id,pdf_object_key,pdf_size_bytes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        scope.tenant.tenantId,
        id,
        input.participantId,
        subject.program_id,
        input.runId,
        input.templateId,
        serial,
        code,
        issuedAt,
        scope.actor.id,
        key,
        pdf.length,
      ],
    );
    await audit(client, scope, "certificate.issued", id);
    await client.query("COMMIT");
    return { id, alreadyIssued: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (uploaded) await deleteMediaObject(key).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const listSql = `SELECT c.*,COALESCE(profile.display_name,u.name) AS participant_name,p.title AS program_name
  FROM certificates c JOIN tenant_participant_profiles profile ON profile.tenant_id=c.tenant_id AND profile.user_id=c.participant_id
  JOIN tenant_users u ON u."tenantId"=profile.tenant_id AND u.id=profile.user_id
  JOIN programs p ON p.tenant_id=c.tenant_id AND p.id=c.program_id`;

export async function listCertificates(scope: Scope, own = false) {
  permit(scope, own ? "certificate.self.read" : "certificate.read");
  const rows = await getTenantPool(scope.tenant).query<CertificateRow>(
    `${listSql} WHERE c.tenant_id=$1 ${own ? "AND c.participant_id=$2" : ""} ORDER BY c.issued_at DESC LIMIT 200`,
    own ? [scope.tenant.tenantId, scope.actor.id] : [scope.tenant.tenantId],
  );
  return rows.rows.map(
    ({ verification_code: _code, pdf_object_key: _key, ...row }) => row,
  );
}

export async function revokeCertificate(scope: Scope, id: string) {
  permit(scope, "certificate.revoke");
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE certificates SET status='REVOKED',revoked_at=now(),revoked_by_user_id=$3 WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' RETURNING id`,
      [scope.tenant.tenantId, id, scope.actor.id],
    );
    if (!result.rowCount)
      throw new DomainError("NOT_FOUND", "گواهی فعال یافت نشد.");
    await audit(client, scope, "certificate.revoked", id);
    await client.query("COMMIT");
    return { id, status: "REVOKED" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getCertificatePdf(scope: Scope, id: string) {
  const broad = scope.actor.permissions.has("certificate.read");
  permit(scope, broad ? "certificate.read" : "certificate.self.read");
  const result = await getTenantPool(scope.tenant).query<{
    pdf_object_key: string;
  }>(
    `SELECT pdf_object_key FROM certificates WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' ${broad ? "" : "AND participant_id=$3"}`,
    broad
      ? [scope.tenant.tenantId, id]
      : [scope.tenant.tenantId, id, scope.actor.id],
  );
  const key = result.rows[0]?.pdf_object_key;
  if (!key) throw new DomainError("NOT_FOUND", "گواهی یافت نشد.");
  return getMediaObject(key);
}

export async function verifyCertificate(tenant: TenantContext, code: string) {
  if (!tenant.features.certificates) return null;
  const now = Date.now();
  const limit = await getTenantPool(tenant).query<{ count: number }>(
    `INSERT INTO tenant_auth_rate_limits (key,count,"lastRequest")
    VALUES ($1,1,$2) ON CONFLICT (key) DO UPDATE SET
    count=CASE WHEN tenant_auth_rate_limits."lastRequest" < $2-60000 THEN 1 ELSE tenant_auth_rate_limits.count+1 END,
    "lastRequest"=CASE WHEN tenant_auth_rate_limits."lastRequest" < $2-60000 THEN $2 ELSE tenant_auth_rate_limits."lastRequest" END
    RETURNING count`,
    [`certificate-verification:${tenant.tenantId}`, now],
  );
  if ((limit.rows[0]?.count ?? 101) > 100)
    throw new DomainError(
      "RATE_LIMITED",
      "تعداد درخواست‌ها بیش از حد مجاز است.",
    );
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return null;
  const result = await getTenantPool(tenant).query<
    Pick<
      CertificateRow,
      | "serial_number"
      | "issued_at"
      | "status"
      | "participant_name"
      | "program_name"
    >
  >(
    `SELECT c.serial_number,c.issued_at,c.status,COALESCE(profile.display_name,u.name) AS participant_name,p.title AS program_name
     FROM certificates c JOIN tenant_participant_profiles profile ON profile.tenant_id=c.tenant_id AND profile.user_id=c.participant_id
     JOIN tenant_users u ON u."tenantId"=profile.tenant_id AND u.id=profile.user_id
     JOIN programs p ON p.tenant_id=c.tenant_id AND p.id=c.program_id
     WHERE c.tenant_id=$1 AND c.verification_code=$2`,
    [tenant.tenantId, code],
  );
  const row = result.rows[0];
  return row?.status === "ACTIVE"
    ? {
        serialNumber: row.serial_number,
        issuedAt: row.issued_at,
        participantName: row.participant_name,
        programName: row.program_name,
      }
    : null;
}
