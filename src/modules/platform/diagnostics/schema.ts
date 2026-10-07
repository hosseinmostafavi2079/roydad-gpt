import { z } from "zod";
import { diagnosticCodes } from "./codes";

const identifier = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
export const severitySchema = z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]);
export const eventInputSchema = z.strictObject({
  code: z.enum(
    Object.keys(diagnosticCodes) as [
      keyof typeof diagnosticCodes,
      ...(keyof typeof diagnosticCodes)[],
    ],
  ),
  tenantId: z.uuid().nullable().optional(),
  requestId: z.uuid().nullable().optional(),
  relatedJobId: z.uuid().nullable().optional(),
  metadata: z.unknown().optional(),
});
export type DiagnosticInput = z.infer<typeof eventInputSchema>;
const common = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  severity: severitySchema.optional(),
  component: identifier.optional(),
  tenantId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};
const range = (value: { from?: string | undefined; to?: string | undefined }) =>
  !value.from ||
  !value.to ||
  (Date.parse(value.to) >= Date.parse(value.from) &&
    Date.parse(value.to) - Date.parse(value.from) <= 31 * 86400000);
export const incidentListSchema = z
  .strictObject({
    ...common,
    status: z.enum(["OPEN", "RECOVERED"]).optional(),
    incidentRef: z
      .string()
      .regex(/^INC-[0-9]{8}-[A-F0-9]{32}$/)
      .optional(),
  })
  .refine(range, "Invalid time range (maximum 31 days)");
export const eventListSchema = z
  .strictObject({ ...common, incidentId: z.uuid().optional() })
  .refine(range, "Invalid time range (maximum 31 days)");
// Strict domain allow-list: arbitrary strings, Error/Request/Response/arrays/nested objects
// cannot enter storage. Sensitive names are rejected, never merely logged/redacted.
export function sanitizeMetadata(
  input: unknown,
): Record<string, string | number | boolean> {
  if (input === undefined) return {};
  if (
    !input ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).length > 8
  )
    throw new Error("Unsafe diagnostic metadata");
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      /password|token|secret|authorization|cookie|apikey|connectionstring|databaseurl|smtpurl|otp|backupcodes|privatekey|stack|body/i.test(
        key.replaceAll("_", ""),
      )
    )
      throw new Error("Unsafe diagnostic metadata");
    if (
      key === "scope" &&
      typeof value === "string" &&
      ["FULL_PLATFORM", "TENANT"].includes(value)
    )
      result[key] = value;
    else if (
      key === "errorCode" &&
      typeof value === "string" &&
      /^(BACKUP_FAILED|FAILED_DATABASE|FAILED_MIGRATION|FAILED_SEED|FAILED_VERIFICATION)$/.test(
        value,
      )
    )
      result[key] = value;
    else if (
      key === "phase" &&
      typeof value === "string" &&
      /^(DATABASE_CREATING|MIGRATING|SEEDING|VERIFYING)$/.test(value)
    )
      result[key] = value;
    else if (key === "retryable" && typeof value === "boolean")
      result[key] = value;
    else if (
      key === "attempt" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 1000
    )
      result[key] = value;
    else throw new Error("Unsafe diagnostic metadata");
  }
  return result;
}
