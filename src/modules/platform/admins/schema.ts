import { z } from "zod";

export const adminEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320);
export const createAdminSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    email: adminEmailSchema,
  })
  .strict();
export const activateAdminSchema = z
  .object({
    email: adminEmailSchema,
    activationCode: z.string().trim().min(1).max(128),
    password: z.string().min(24).max(128),
    confirmPassword: z.string().min(24).max(128),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "رمز عبور و تکرار آن یکسان نیستند.",
  });
export const adminIdSchema = z.string().uuid();
export const emptyAdminActionSchema = z.object({}).strict();
export const adminListSchema = z
  .object({ offset: z.coerce.number().int().min(0).max(10000).default(0) })
  .strict();
export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type ActivateAdminInput = z.infer<typeof activateAdminSchema>;
