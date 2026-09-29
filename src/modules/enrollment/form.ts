import { z } from "zod";
import { DomainError } from "@/shared/errors/domain-error";

const fieldSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(120),
  type: z.enum([
    "text",
    "textarea",
    "number",
    "email",
    "phone",
    "select",
    "radio",
    "checkbox",
    "date",
  ]),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
});

export const registrationFormSchema = z
  .strictObject({
    version: z.number().int().positive().max(100000),
    fields: z.array(fieldSchema).max(30),
  })
  .superRefine((value, context) => {
    const keys = new Set<string>();
    value.fields.forEach((field, index) => {
      if (keys.has(field.key))
        context.addIssue({
          code: "custom",
          message: "Duplicate field key.",
          path: ["fields", index, "key"],
        });
      keys.add(field.key);
      if (
        ["select", "radio"].includes(field.type) &&
        field.options.length === 0
      )
        context.addIssue({
          code: "custom",
          message: "Options are required.",
          path: ["fields", index, "options"],
        });
    });
  });

export type RegistrationForm = z.infer<typeof registrationFormSchema>;

export function validateAnswers(
  schemaValue: unknown,
  answerValue: unknown,
): {
  form: RegistrationForm;
  answers: Record<string, string | number | boolean>;
} {
  const form = registrationFormSchema.safeParse(schemaValue);
  if (!form.success)
    throw new DomainError(
      "VALIDATION_FAILED",
      "Registration form is unavailable.",
    );
  if (
    typeof answerValue !== "object" ||
    !answerValue ||
    Array.isArray(answerValue)
  )
    throw new DomainError(
      "VALIDATION_FAILED",
      "Registration answers are invalid.",
    );
  const input = answerValue as Record<string, unknown>;
  const expected = new Set(form.data.fields.map((field) => field.key));
  if (Object.keys(input).some((key) => !expected.has(key)))
    throw new DomainError(
      "VALIDATION_FAILED",
      "Registration answers contain an unknown field.",
    );
  const answers: Record<string, string | number | boolean> = {};
  for (const field of form.data.fields) {
    const value = input[field.key];
    if (value === undefined || value === null || value === "") {
      if (field.required)
        throw new DomainError(
          "VALIDATION_FAILED",
          `پاسخ «${field.label}» لازم است.`,
        );
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof value !== "boolean" || (field.required && !value))
        throw new DomainError(
          "VALIDATION_FAILED",
          `پاسخ «${field.label}» نامعتبر است.`,
        );
    } else if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new DomainError(
          "VALIDATION_FAILED",
          `پاسخ «${field.label}» نامعتبر است.`,
        );
    } else {
      if (typeof value !== "string" || value.length > 2000)
        throw new DomainError(
          "VALIDATION_FAILED",
          `پاسخ «${field.label}» نامعتبر است.`,
        );
      if (field.type === "email" && !z.email().safeParse(value).success)
        throw new DomainError(
          "VALIDATION_FAILED",
          `ایمیل «${field.label}» نامعتبر است.`,
        );
      if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new DomainError(
          "VALIDATION_FAILED",
          `تاریخ «${field.label}» نامعتبر است.`,
        );
      if (
        ["select", "radio"].includes(field.type) &&
        !field.options.includes(value)
      )
        throw new DomainError(
          "VALIDATION_FAILED",
          `گزینه «${field.label}» نامعتبر است.`,
        );
    }
    answers[field.key] = value as string | number | boolean;
  }
  return { form: form.data, answers };
}
