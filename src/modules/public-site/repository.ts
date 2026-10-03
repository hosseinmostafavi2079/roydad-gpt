import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { programTypes } from "@/modules/program-core/schema";
import { DomainError } from "@/shared/errors/domain-error";

export type PublicRun = {
  id: string;
  title: string;
  slug: string;
  type: string;
  category: string;
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
  instructorSlug: string | null;
  instructorTitle: string | null;
  instructorShortBio: string | null;
  instructorPhotoUrl: string | null;
  instructorSpecialties: string[] | null;
  confirmedCount: number;
  registrationFormSchema: unknown;
  coverUrl: string | null;
  videoUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  canonicalPath: string;
  ogImageUrl: string;
};

const publicRunsSql = `SELECT r.id, r.title, r.id::text AS slug, p.type, p.category,
  r.seo_title AS "seoTitle", r.seo_description AS "seoDescription",
  r.canonical_path AS "canonicalPath", r.og_image_url AS "ogImageUrl",
  p.short_description AS summary, p.description, p.objectives,
  p.prerequisites, p.intended_audience AS audience,
  r.starts_at AS "startsAt", r.ends_at AS "endsAt",
  r.registration_starts_at AS "registrationStartsAt",
  r.registration_ends_at AS "registrationEndsAt",
  r.delivery_mode AS "deliveryMode", r.capacity,
  r.price_amount::text AS "priceAmount", r.price_currency AS "priceCurrency",
  r.waitlist_enabled AS "waitlistEnabled", r.registration_form_schema AS "registrationFormSchema", v.name AS venue,
  instructor.display_name AS instructor,
  public_instructor.slug AS "instructorSlug",
  public_instructor.content->>'title' AS "instructorTitle",
  public_instructor.content->>'shortBio' AS "instructorShortBio",
  public_instructor.content->>'photoUrl' AS "instructorPhotoUrl",
  ARRAY(SELECT jsonb_array_elements_text(COALESCE(public_instructor.content->'specialties','[]'::jsonb))) AS "instructorSpecialties",
  (SELECT '/api/media/' || m.id::text FROM tenant_media m WHERE m.tenant_id=p.tenant_id AND m.resource_id=p.id AND m.purpose='PROGRAM_COVER') AS "coverUrl",
  (SELECT '/api/media/' || m.id::text FROM tenant_media m WHERE m.tenant_id=p.tenant_id AND m.resource_id=p.id AND m.purpose='PROGRAM_VIDEO') AS "videoUrl",
  (SELECT count(*)::int FROM enrollments e WHERE e.tenant_id=r.tenant_id AND e.run_id=r.id
   AND (e.status='CONFIRMED' OR (e.status='AWAITING_PAYMENT' AND e.payment_expires_at > now()))) AS "confirmedCount"
  FROM program_runs r
  JOIN programs p ON p.tenant_id = r.tenant_id AND p.id = r.program_id
  LEFT JOIN venues v ON v.tenant_id = r.tenant_id AND v.id = r.venue_id
  LEFT JOIN run_instructors ri ON ri.tenant_id = r.tenant_id AND ri.run_id = r.id AND ri.is_lead
  LEFT JOIN tenant_instructor_profiles instructor ON instructor.tenant_id = ri.tenant_id AND instructor.user_id = ri.instructor_id
  LEFT JOIN tenant_instructor_public_profiles public_instructor ON public_instructor.tenant_id=ri.tenant_id AND public_instructor.user_id=ri.instructor_id AND public_instructor.published=true
  WHERE r.tenant_id = $1 AND r.state = 'PUBLISHED' AND p.status = 'ACTIVE'`;

export async function listPublicRuns(
  tenant: TenantContext,
  search = "",
  filters: {
    category?: string;
    type?: string;
    instructor?: string;
    period?: string;
    page?: number;
  } = {},
): Promise<PublicRun[]> {
  if (!tenant.features.courses && !tenant.features.events) return [];
  const boundedSearch = search.trim().slice(0, 80);
  const category = (filters.category ?? "").trim().slice(0, 120);
  const instructor = (filters.instructor ?? "").trim().slice(0, 120);
  const type = programTypes.includes(
    (filters.type ?? "") as (typeof programTypes)[number],
  )
    ? (filters.type ?? "")
    : "";
  const period = ["upcoming", "past"].includes(filters.period ?? "")
    ? (filters.period ?? "")
    : "";
  const page = Math.min(
    100,
    Math.max(1, Number.isInteger(filters.page) ? (filters.page ?? 1) : 1),
  );
  const result = await getTenantPool(tenant).query<PublicRun>(
    `${publicRunsSql} AND ($2 = '' OR p.title ILIKE '%' || $2 || '%' OR r.title ILIKE '%' || $2 || '%')
      AND ($3 = '' OR p.category=$3) AND ($4 = '' OR p.type=$4)
      AND ($5 = '' OR instructor.display_name ILIKE '%' || $5 || '%')
      AND ($6 = '' OR ($6='upcoming' AND r.ends_at>=now()) OR ($6='past' AND r.ends_at<now()))
      ORDER BY r.starts_at ASC LIMIT 24 OFFSET $7`,
    [
      tenant.tenantId,
      boundedSearch,
      category,
      type,
      instructor,
      period,
      (page - 1) * 24,
    ],
  );
  return result.rows;
}

export async function listPublicCategories(
  tenant: TenantContext,
): Promise<string[]> {
  if (!tenant.features.courses && !tenant.features.events) return [];
  const result = await getTenantPool(tenant).query<{ category: string }>(
    `SELECT DISTINCT p.category FROM programs p JOIN program_runs r ON r.tenant_id=p.tenant_id AND r.program_id=p.id
     WHERE p.tenant_id=$1 AND p.status='ACTIVE' AND r.state='PUBLISHED' AND p.category<>''
     ORDER BY p.category LIMIT 40`,
    [tenant.tenantId],
  );
  return result.rows.map((row) => row.category);
}

export async function getPublicRunSessions(
  tenant: TenantContext,
  runId: string,
) {
  const result = await getTenantPool(tenant).query<{
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    deliveryMode: string;
  }>(
    `SELECT id,title,starts_at AS "startsAt",ends_at AS "endsAt",delivery_mode AS "deliveryMode"
     FROM program_sessions WHERE tenant_id=$1 AND run_id=$2 AND status='SCHEDULED' ORDER BY starts_at LIMIT 50`,
    [tenant.tenantId, runId],
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

export async function listInstructorRuns(
  tenant: TenantContext,
  publicProfileId: string,
): Promise<PublicRun[]> {
  if (!tenant.features.courses && !tenant.features.events) return [];
  const result = await getTenantPool(tenant).query<PublicRun>(
    `${publicRunsSql} AND ri.instructor_id=(SELECT user_id FROM tenant_instructor_public_profiles
      WHERE tenant_id=$1 AND id=$2 AND published=true) ORDER BY r.starts_at DESC LIMIT 24`,
    [tenant.tenantId, publicProfileId],
  );
  return result.rows;
}
