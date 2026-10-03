import "server-only";

import { z } from "zod";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import { DomainError } from "@/shared/errors/domain-error";

const mediaUrl = z.union([
  z.literal(""),
  z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
]);
const internalPath = z.string().regex(/^\/(?:$|[a-z0-9][a-z0-9\-/]*$)/);
export const pageSlug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = z.string().trim().max(5000);
const blockId = { id: z.uuid() };
const block = z.discriminatedUnion("type", [
  z.strictObject({
    ...blockId,
    type: z.literal("heading"),
    text: text.max(160),
  }),
  z.strictObject({ ...blockId, type: z.literal("text"), text }),
  z.strictObject({
    ...blockId,
    type: z.literal("list"),
    ordered: z.boolean(),
    items: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(30)
      .refine((items) => new Set(items).size === items.length),
  }),
  z.strictObject({
    ...blockId,
    type: z.literal("image"),
    imageUrl: mediaUrl,
    alt: z.string().trim().max(160),
    caption: z.string().trim().max(300),
  }),
  z.strictObject({
    ...blockId,
    type: z.literal("imageText"),
    imageUrl: mediaUrl,
    alt: z.string().trim().max(160),
    text,
  }),
  z.strictObject({
    ...blockId,
    type: z.literal("callout"),
    text: text.max(1000),
  }),
  z.strictObject({
    ...blockId,
    type: z.literal("cta"),
    text: text.max(100),
    href: internalPath,
  }),
  z.strictObject({ ...blockId, type: z.literal("faqGroup") }),
]);
export const informationPageInput = z.strictObject({
  id: z.uuid().optional(),
  slug: pageSlug,
  title: z.string().trim().min(2).max(160),
  blocks: z.array(block).max(30),
  seoTitle: z.string().trim().max(160),
  metaDescription: z.string().trim().max(300),
  published: z.boolean(),
});
export type InformationPageInput = z.infer<typeof informationPageInput>;

const entryContent = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("FAQ"),
    question: z.string().trim().min(2).max(300),
    answer: text.min(2),
  }),
  z.strictObject({
    kind: z.literal("TESTIMONIAL"),
    name: z.string().trim().min(2).max(120),
    role: z.string().trim().max(120),
    quote: z.string().trim().min(2).max(1500),
    photoUrl: mediaUrl,
  }),
  z.strictObject({
    kind: z.literal("GALLERY"),
    imageUrl: mediaUrl,
    alt: z.string().trim().max(160),
    caption: z.string().trim().max(300),
  }),
]);
export const siteEntryInput = z.strictObject({
  id: z.uuid().optional(),
  enabled: z.boolean(),
  order: z.number().int().min(0).max(999),
  content: entryContent,
});
export type SiteEntryInput = z.infer<typeof siteEntryInput>;

type EntryRow = {
  id: string;
  kind: "FAQ" | "TESTIMONIAL" | "GALLERY";
  content: SiteEntryInput["content"];
  enabled: boolean;
  sort_order: number;
};
type PageRow = {
  id: string;
  slug: string;
  title: string;
  blocks: InformationPageInput["blocks"];
  seo_title: string;
  meta_description: string;
  published: boolean;
};
function mapEntry(row: EntryRow) {
  return {
    id: row.id,
    enabled: row.enabled,
    order: row.sort_order,
    content: entryContent.parse({ ...row.content, kind: row.kind }),
  };
}
function mapPage(row: PageRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    blocks: row.blocks,
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    published: row.published,
  };
}

export async function listSiteEntries(
  tenant: TenantContext,
  kind: EntryRow["kind"],
  publicOnly = true,
) {
  const result = await getTenantPool(tenant).query<EntryRow>(
    `SELECT id,kind,content,enabled,sort_order FROM tenant_site_entries
     WHERE tenant_id=$1 AND kind=$2 ${publicOnly ? "AND enabled=true" : ""}
     ORDER BY sort_order,id LIMIT 100`,
    [tenant.tenantId, kind],
  );
  return result.rows
    .map(mapEntry)
    .filter(
      (entry) =>
        !publicOnly ||
        entry.content.kind !== "GALLERY" ||
        Boolean(entry.content.imageUrl),
    );
}

export async function saveSiteEntry(
  tenant: TenantContext,
  actor: TenantActor,
  input: SiteEntryInput,
  requestId: string,
) {
  if (tenant.tenantId !== actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(actor.permissions, "website.manage");
  const value = siteEntryInput.parse(input);
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<EntryRow>(
      `INSERT INTO tenant_site_entries (tenant_id,id,kind,content,enabled,sort_order)
       VALUES ($1,COALESCE($2::uuid,gen_random_uuid()),$3,$4::jsonb,$5,$6)
       ON CONFLICT (tenant_id,id) DO UPDATE SET content=excluded.content,enabled=excluded.enabled,
         sort_order=excluded.sort_order,updated_at=now()
       WHERE tenant_site_entries.kind=excluded.kind
       RETURNING id,kind,content,enabled,sort_order`,
      [
        tenant.tenantId,
        value.id ?? null,
        value.content.kind,
        JSON.stringify(value.content),
        value.enabled,
        value.order,
      ],
    );
    if (!result.rows[0])
      throw new DomainError("CONFLICT", "نوع مورد قابل تغییر نیست.");
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id)
      VALUES ($1,$2,'website.content_updated','WEBSITE',$3,$4)`,
      [tenant.tenantId, actor.id, result.rows[0].id, requestId],
    );
    await client.query("COMMIT");
    return mapEntry(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSiteEntry(
  tenant: TenantContext,
  actor: TenantActor,
  id: string,
) {
  if (tenant.tenantId !== actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(actor.permissions, "website.manage");
  await getTenantPool(tenant).query(
    "DELETE FROM tenant_site_entries WHERE tenant_id=$1 AND id=$2",
    [tenant.tenantId, z.uuid().parse(id)],
  );
  return { removed: true };
}

export async function listInformationPages(
  tenant: TenantContext,
  publicOnly = true,
) {
  const result = await getTenantPool(tenant).query<PageRow>(
    `SELECT id,slug,title,blocks,seo_title,meta_description,published FROM tenant_information_pages
     WHERE tenant_id=$1 ${publicOnly ? "AND published=true" : ""} ORDER BY title LIMIT 100`,
    [tenant.tenantId],
  );
  return result.rows.map(mapPage);
}

export async function getInformationPage(tenant: TenantContext, slug: string) {
  const result = await getTenantPool(tenant).query<PageRow>(
    `SELECT id,slug,title,blocks,seo_title,meta_description,published FROM tenant_information_pages
     WHERE tenant_id=$1 AND slug=$2 AND published=true`,
    [tenant.tenantId, pageSlug.parse(slug)],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Page not found.");
  return mapPage(result.rows[0]);
}

export async function saveInformationPage(
  tenant: TenantContext,
  actor: TenantActor,
  input: InformationPageInput,
  requestId: string,
) {
  if (tenant.tenantId !== actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(actor.permissions, "website.manage");
  const value = informationPageInput.parse(input);
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PageRow>(
      `INSERT INTO tenant_information_pages (tenant_id,id,slug,title,blocks,seo_title,meta_description,published)
       VALUES ($1,COALESCE($2::uuid,gen_random_uuid()),$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (tenant_id,id) DO UPDATE SET slug=excluded.slug,title=excluded.title,blocks=excluded.blocks,
       seo_title=excluded.seo_title,meta_description=excluded.meta_description,published=excluded.published,updated_at=now()
       RETURNING id,slug,title,blocks,seo_title,meta_description,published`,
      [
        tenant.tenantId,
        value.id ?? null,
        value.slug,
        value.title,
        JSON.stringify(value.blocks),
        value.seoTitle,
        value.metaDescription,
        value.published,
      ],
    );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id)
      VALUES ($1,$2,'website.page_updated','WEBSITE',$3,$4)`,
      [tenant.tenantId, actor.id, result.rows[0]?.id, requestId],
    );
    const saved = result.rows[0];
    if (!saved)
      throw new Error("Information page was not returned after save.");
    await client.query("COMMIT");
    return mapPage(saved);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
