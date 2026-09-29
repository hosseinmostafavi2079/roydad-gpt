import { z } from "zod";

const permissionKey = z.string().regex(/^[a-z][a-z0-9.]{1,63}$/);
const roleCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{1,79}$/);

export const inviteTenantUserSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  roleCodes: z
    .array(roleCode)
    .min(1)
    .max(11)
    .refine((items) => new Set(items).size === items.length),
  profileType: z.enum(["STAFF", "INSTRUCTOR", "PARTICIPANT"]).default("STAFF"),
  title: z.string().trim().max(120).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
});

export const acceptTenantInvitationSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(12).max(128),
});

export const createTenantRoleSchema = z.strictObject({
  code: roleCode,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  permissionKeys: z
    .array(permissionKey)
    .max(64)
    .refine((items) => new Set(items).size === items.length),
});

export const updateTenantRoleSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  permissionKeys: z
    .array(permissionKey)
    .max(64)
    .refine((items) => new Set(items).size === items.length),
});

export const assignTenantRolesSchema = z.strictObject({
  roleCodes: z
    .array(roleCode)
    .max(11)
    .refine((items) => new Set(items).size === items.length),
});

export const tenantUserStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]),
});

export const tenantUserProfileSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    title: z.string().trim().max(120).nullable().optional(),
    displayName: z.string().trim().min(2).max(120).optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "At least one profile field must be supplied.",
    },
  );

export const tenantUserUpdateSchema = z.union([
  tenantUserStatusSchema,
  tenantUserProfileSchema,
]);

export const tenantUserIdSchema = z.string().uuid();
export const tenantRoleIdSchema = z.string().uuid();
