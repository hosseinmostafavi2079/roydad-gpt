import { z } from "zod";

export const backupScopeSchema = z.enum(["FULL_PLATFORM", "TENANT"]);
export const backupTriggerSchema = z.enum(["MANUAL", "SCHEDULED"]);
export const backupStateSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "VERIFYING",
  "SUCCEEDED",
  "FAILED",
  "PRUNED",
]);
export const backupPolicySchema = z
  .strictObject({
    enabled: z.boolean(),
    scope: z.literal("FULL_PLATFORM"),
    frequency: z.enum(["DAILY", "WEEKLY"]),
    executionTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_+/-]+$/)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone"),
    retentionCount: z.number().int().min(1).max(100),
  })
  .superRefine((policy, ctx) => {
    if (policy.frequency === "WEEKLY" && policy.weekday == null)
      ctx.addIssue({
        code: "custom",
        path: ["weekday"],
        message: "Weekly policy requires weekday (0=Sunday)",
      });
    if (policy.frequency === "DAILY" && policy.weekday != null)
      ctx.addIssue({
        code: "custom",
        path: ["weekday"],
        message: "Daily policy has no weekday",
      });
  });

export type BackupScope = z.infer<typeof backupScopeSchema>;
export type BackupTrigger = z.infer<typeof backupTriggerSchema>;
export type BackupState = z.infer<typeof backupStateSchema>;
export type BackupPolicy = z.infer<typeof backupPolicySchema>;
