import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { DomainError } from "@/shared/errors/domain-error";

export type PublicRun = {
  id: string;
  title: string;
  slug: string;
  type: string;
  summary: string;
  description: string;
  objectives: string;
  prerequisites: string;
  audience: string;
  startsAt: Date;
  endsAt: Date;
  registrationStartsAt: Date | null;
  registrationEndsAt: Date | null;
  deliveryMode: string;
  capacity: number;
  priceAmount: string;
  priceCurrency: string;
  waitlistEnabled: boolean;
  venue: string | null;
  instructor: string | null;
  confirmedCount: number;
  registrationFormSchema: unknown;
  coverUrl: string | null;
  videoUrl: string | null;
};

const publicRunsSql = `SELECT r.id, r.title, r.id::text AS slug, p.type,
  p.short_description AS summary, p.description, p.objectives,
  p.prerequisites, p.intended_audience AS audience,
  r.starts_at AS "startsAt", r.ends_at AS "endsAt",
  r.registration_starts_at AS "registrationStartsAt",
  r.registration_ends_at AS "registrationEndsAt",
  r.delivery_mode AS "deliveryMode", r.capacity,
  r.price_amount::text AS "priceAmount", r.price_currency AS "priceCurrency",
  r.waitlist_enabled AS "waitlistEnabled", r.registration_form_schema AS "registrationFormSchema", v.name AS venue,
  instructor.display_name AS instructor,
  (SELECT '/api/media/' || m.id::text FROM tenant_media m WHERE m.tenant_id=p.tenant_id AND m.resource_id=p.id AND m.purpose='PROGRAM_COVER') AS "coverUrl",
  (SELECT '/api/media/' || m.id::text FROM tenant_media m WHERE m.tenant_id=p.tenant_id AND m.resource_id=p.id AND m.purpose='PROGRAM_VIDEO') AS "videoUrl",
  (SELECT count(*)::int FROM enrollments e WHERE e.tenant_id=r.tenant_id AND e.run_id=r.id
   AND (e.status='CONFIRMED' OR (e.status='AWAITING_PAYMENT' AND e.payment_expires_at > now()))) AS "confirmedCount"
  FROM program_runs r
  JOIN programs p ON p.tenant_id = r.tenant_id AND p.id = r.program_id
  LEFT JOIN venues v ON v.tenant_id = r.tenant_id AND v.id = r.venue_id
  LEFT JOIN run_instructors ri ON ri.tenant_id = r.tenant_id AND ri.run_id = r.id AND ri.is_lead
  LEFT JOIN tenant_instructor_profiles instructor ON instructor.tenant_id = ri.tenant_id AND instructor.user_id = ri.instructor_id
  WHERE r.tenant_id = $1 AND r.state = 'PUBLISHED' AND p.status = 'ACTIVE'`;

export async function listPublicRuns(
  tenant: TenantContext,
  search = "",
): Promise<PublicRun[]> {
  if (!tenant.features.courses && !tenant.features.events) return [];
  const boundedSearch = search.trim().slice(0, 80);
  const result = await getTenantPool(tenant).query<PublicRun>(
    `${publicRunsSql} AND ($2 = '' OR p.title ILIKE '%' || $2 || '%' OR r.title ILIKE '%' || $2 || '%')
      ORDER BY r.starts_at ASC LIMIT 100`,
    [tenant.tenantId, boundedSearch],
  );
  return result.rows;
}

export async function getPublicRun(
  tenant: TenantContext,
  slug: string,
): Promise<PublicRun> {
  if (!tenant.features.courses && !tenant.features.events)
    throw new DomainError("NOT_FOUND", "Event not found.");
  const result = await getTenantPool(tenant).query<PublicRun>(
    `${publicRunsSql} AND r.id::text = $2 LIMIT 1`,
    [tenant.tenantId, slug],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Event not found.");
  return result.rows[0];
}
