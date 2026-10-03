import "server-only";

import { z } from "zod";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import { DomainError } from "@/shared/errors/domain-error";

export const publicSlug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const short = z.string().trim().max(160);
const long = z.string().trim().max(5000);
const year = z.number().int().min(1900).max(2200).nullable();
const httpsUrl = z.union([
  z.literal(""),
  z
    .url()
    .max(2048)
    .refine((value) => new URL(value).protocol === "https:"),
]);
const mediaUrl = z.union([
  z.literal(""),
  z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
]);
const experience = z.strictObject({
  id: z.uuid(),
  position: short,
  organization: short,
  startYear: year,
  endYear: year,
  current: z.boolean(),
  description: z.string().trim().max(1000),
});
const education = z.strictObject({
  id: z.uuid(),
  degree: short,
  field: short,
  institution: short,
  year,
});
export const instructorContentInput = z.strictObject({
  name: z.string().trim().min(2).max(120),
  title: short,
  shortBio: z.string().trim().max(500),
  biography: long,
  specialties: z.array(short.min(1)).max(16),
  yearsExperience: z.number().int().min(0).max(80).nullable(),
  experience: z.array(experience).max(20),
  education: z.array(education).max(20),
  certifications: z.array(short.min(1)).max(20),
  honors: z.array(short.min(1)).max(20),
  books: z.array(short.min(1)).max(20),
  publications: z.array(short.min(1)).max(20),
  projects: z.array(short.min(1)).max(20),
  websiteUrl: httpsUrl,
  linkedInUrl: httpsUrl,
  photoUrl: mediaUrl,
  resumeUrl: mediaUrl,
  showResume: z.boolean(),
  showExperience: z.boolean(),
  showEducation: z.boolean(),
  showWorks: z.boolean(),
  seoTitle: short.default(""),
  metaDescription: z.string().trim().max(300).default(""),
  canonicalPath: z
    .union([
      z.literal(""),
      z.string().regex(/^\/instructors\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
    ])
    .default(""),
});
export type InstructorContent = z.infer<typeof instructorContentInput>;
export const instructorProfileInput = z.strictObject({
  slug: publicSlug,
  published: z.boolean(),
  content: instructorContentInput,
});
export type InstructorProfileInput = z.infer<typeof instructorProfileInput>;

type ProfileRow = {
  id: string;
  slug: string;
  published: boolean;
  content: InstructorContent;
};
export function mapPublicInstructor(row: ProfileRow) {
  const content = instructorContentInput.parse(row.content);
  return {
    id: row.id,
    slug: row.slug,
    ...content,
    experience: content.showExperience ? content.experience : [],
    education: content.showEducation ? content.education : [],
    certifications: content.showWorks ? content.certifications : [],
    honors: content.showWorks ? content.honors : [],
    books: content.showWorks ? content.books : [],
    publications: content.showWorks ? content.publications : [],
    projects: content.showWorks ? content.projects : [],
    resumeUrl: content.showResume ? content.resumeUrl : "",
  };
}

export async function listPublicInstructors(tenant: TenantContext, page = 1) {
  if (!tenant.features.public_website) return [];
  const offset =
    (Math.min(100, Math.max(1, Number.isInteger(page) ? page : 1)) - 1) * 24;
  const result = await getTenantPool(tenant).query<ProfileRow>(
    `SELECT id,slug,published,content FROM tenant_instructor_public_profiles
     WHERE tenant_id=$1 AND published=true ORDER BY content->>'name',id LIMIT 24 OFFSET $2`,
    [tenant.tenantId, offset],
  );
  return result.rows.map((row) => {
    const profile = mapPublicInstructor(row);
    return {
      id: profile.id,
      slug: profile.slug,
      name: profile.name,
      title: profile.title,
      shortBio: profile.shortBio,
      specialties: profile.specialties,
      photoUrl: profile.photoUrl,
    };
  });
}

export async function getPublicInstructor(tenant: TenantContext, slug: string) {
  if (!tenant.features.public_website)
    throw new DomainError("NOT_FOUND", "Instructor not found.");
  const result = await getTenantPool(tenant).query<ProfileRow>(
    `SELECT id,slug,published,content FROM tenant_instructor_public_profiles
     WHERE tenant_id=$1 AND slug=$2 AND published=true`,
    [tenant.tenantId, publicSlug.parse(slug)],
  );
  if (!result.rows[0])
    throw new DomainError("NOT_FOUND", "Instructor not found.");
  return mapPublicInstructor(result.rows[0]);
}

export async function getAdminInstructorProfile(
  tenant: TenantContext,
  actor: TenantActor,
  userId: string,
) {
  authorize(actor.permissions, "instructor.update");
  const result = await getTenantPool(tenant).query<ProfileRow>(
    `SELECT id,slug,published,content FROM tenant_instructor_public_profiles WHERE tenant_id=$1 AND user_id=$2`,
    [tenant.tenantId, userId],
  );
  return result.rows[0] ?? null;
}

export async function saveInstructorProfile(
  tenant: TenantContext,
  actor: TenantActor,
  userId: string,
  input: InstructorProfileInput,
  requestId: string,
) {
  if (actor.tenantId !== tenant.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(actor.permissions, "instructor.update");
  const value = instructorProfileInput.parse(input);
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ProfileRow>(
      `INSERT INTO tenant_instructor_public_profiles (tenant_id,user_id,slug,published,content)
       SELECT $1::uuid,$2::varchar(64),$3::varchar(80),$4::boolean,$5::jsonb FROM tenant_instructor_profiles
       WHERE tenant_id=$1 AND user_id=$2
       ON CONFLICT (tenant_id,user_id) DO UPDATE SET slug=excluded.slug,published=excluded.published,
         content=excluded.content,updated_at=now()
       RETURNING id,slug,published,content`,
      [
        tenant.tenantId,
        userId,
        value.slug,
        value.published,
        JSON.stringify(value.content),
      ],
    );
    if (!result.rows[0])
      throw new DomainError("NOT_FOUND", "Instructor not found.");
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id)
       VALUES ($1,$2,'instructor.public_profile_updated','INSTRUCTOR',$3,$4)`,
      [tenant.tenantId, actor.id, result.rows[0].id, requestId],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
