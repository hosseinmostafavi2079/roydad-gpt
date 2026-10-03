import { z } from "zod";
import {
  featureKeys,
  featureOverrideSchema,
  limitKeys,
  limitOverrideSchema,
} from "@/modules/platform/plans/schema";

export const createTenantSchema = z.strictObject({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  legalName: z.string().trim().min(2).max(200).optional(),
  displayName: z.string().trim().min(2).max(120),
  planCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,47}$/),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(320),
  creationKey: z.uuid().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#145D58"),
  preset: z.enum(["SIMPLE", "EDUCATIONAL", "PROFESSIONAL"]).default("SIMPLE"),
  featureOverrides: z
    .array(featureOverrideSchema)
    .max(featureKeys.length)
    .default([]),
  limitOverrides: z
    .array(limitOverrideSchema)
    .max(limitKeys.length)
    .default([]),
});
export const createTenantRequestSchema = createTenantSchema.extend({
  creationKey: z.uuid(),
});

export const inviteTenantOwnerSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
});

export const updateTenantSchema = z
  .strictObject({
    legalName: z.string().trim().min(2).max(200).optional(),
    displayName: z.string().trim().min(2).max(120).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
      .optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "At least one tenant field must be supplied.",
    },
  );

export const updateStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export const updateTenantPlanSchema = z.strictObject({
  planCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,47}$/),
});

export const updateTenantFeaturesSchema = z.strictObject({
  overrides: z.array(featureOverrideSchema).min(1).max(featureKeys.length),
});

export const updateTenantLimitsSchema = z.strictObject({
  overrides: z.array(limitOverrideSchema).min(1).max(limitKeys.length),
});

export const updateBrandingSchema = z.strictObject({
  brandName: z.string().trim().min(2).max(120),
  logoAssetKey: z.string().trim().max(512).nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const createDomainSchema = z.strictObject({
  hostname: z.string().trim().min(3).max(253),
  isPrimary: z.boolean().default(false),
});

export const listTenantsSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(80).optional(),
    status: z
      .enum(["PROVISIONING", "ACTIVE", "SUSPENDED", "FAILED"])
      .optional(),
    plan: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,47}$/)
      .optional(),
  })
  .strict();

export const tenantIdSchema = z.string().uuid();

export type CreateTenantInput = z.input<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
