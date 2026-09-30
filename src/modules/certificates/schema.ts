import { z } from "zod";

export const templateFields = z.strictObject({
  message: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .default(
      "گواهی می‌شود {{participantName}} در برنامه {{programName}} شرکت کرده است.",
    ),
  showOrganizationLogo: z.boolean().default(true),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#174b57"),
});
export const templateInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  fields: templateFields,
});
export const issueInput = z.strictObject({
  runId: z.uuid(),
  participantId: z.string().min(1).max(64),
  templateId: z.uuid(),
});
export type TemplateInput = z.infer<typeof templateInput>;
export type TemplateFields = z.infer<typeof templateFields>;

export function fillTemplate(
  message: string,
  values: Record<
    "participantName" | "programName" | "instructorName" | "issuedAt",
    string
  >,
): string {
  return message.replace(
    /{{(participantName|programName|instructorName|issuedAt)}}/g,
    (_match, key: keyof typeof values) => values[key],
  );
}

export function validateTemplateMessage(message: string): void {
  if (
    /{{|}}/.test(
      message.replace(
        /{{(?:participantName|programName|instructorName|issuedAt)}}/g,
        "",
      ),
    )
  ) {
    throw new Error("Unsupported certificate placeholder.");
  }
}
