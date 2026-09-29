import { z } from "zod";

export const featureKeys = [
  "public_website",
  "registration",
  "waitlist",
  "password_login",
  "email_otp",
  "courses",
  "events",
  "attendance",
  "qr_attendance",
  "payments",
  "certificates",
  "quiz",
  "assignments",
  "crm",
  "sms",
  "email",
  "ai",
  "custom_domain",
  "branches",
] as const;

export const limitKeys = [
  "max_programs",
  "max_instructors",
  "max_staff",
  "max_participants",
  "max_active_runs",
  "max_storage_mb",
  "monthly_sms",
  "monthly_email",
  "max_branches",
  "max_custom_domains",
] as const;

export const featureSetSchema = z.object({
  public_website: z.boolean().default(true),
  registration: z.boolean().default(true),
  waitlist: z.boolean().default(true),
  password_login: z.boolean().default(true),
  email_otp: z.boolean().default(false),
  courses: z.boolean(),
  events: z.boolean(),
  attendance: z.boolean(),
  qr_attendance: z.boolean(),
  payments: z.boolean(),
  certificates: z.boolean(),
  quiz: z.boolean(),
  assignments: z.boolean(),
  crm: z.boolean(),
  sms: z.boolean(),
  email: z.boolean(),
  ai: z.boolean(),
  custom_domain: z.boolean(),
  branches: z.boolean(),
});

export const limitSetSchema = z.object({
  max_programs: z.number().int().min(0).max(100000).default(100000),
  max_instructors: z.number().int().min(0).max(100000).default(100000),
  max_staff: z.number().int().min(0).max(100000),
  max_participants: z.number().int().min(0).max(10000000),
  max_active_runs: z.number().int().min(0).max(100000),
  max_storage_mb: z.number().int().min(0).max(100000000),
  monthly_sms: z.number().int().min(0).max(100000000),
  monthly_email: z.number().int().min(0).max(100000000),
  max_branches: z.number().int().min(0).max(100000),
  max_custom_domains: z.number().int().min(0).max(1000),
});

export const featureOverrideSchema = z.strictObject({
  key: z.enum(featureKeys),
  enabled: z.boolean().nullable(),
});

export const limitOverrideSchema = z.strictObject({
  key: z.enum(limitKeys),
  value: z.number().int().min(0).max(100000000).nullable(),
});

export const createPlanSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,47}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  isActive: z.boolean().default(true),
  features: featureSetSchema,
  limits: limitSetSchema,
});

export const updatePlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
  features: featureSetSchema,
  limits: limitSetSchema,
});

export type FeatureKey = (typeof featureKeys)[number];
export type LimitKey = (typeof limitKeys)[number];
export type FeatureSet = z.infer<typeof featureSetSchema>;
export type LimitSet = z.infer<typeof limitSetSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
