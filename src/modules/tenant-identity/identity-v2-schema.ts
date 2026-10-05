import { z } from "zod";

export function normalizeIranianPhone(value: string): string {
  const digits = value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) =>
      String(
        "۰۱۲۳۴۵۶۷۸۹".includes(digit)
          ? "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)
          : "٠١٢٣٤٥٦٧٨٩".indexOf(digit),
      ),
    )
    .replace(/[\s()-]/g, "");
  const local = digits.replace(/^(?:\+98|0098|0)/, "");
  if (!/^9\d{9}$/.test(local)) throw new Error("شماره موبایل معتبر نیست.");
  return `+98${local}`;
}

export function normalizeUsername(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[a-z][a-z0-9_]{2,29}$/.test(normalized) ||
    ["admin", "root", "system", "support", "eventos", "administrator"].includes(
      normalized,
    )
  )
    throw new Error("نام کاربری معتبر نیست.");
  return normalized;
}

export const loginMethodsSchema = z
  .strictObject({
    sms_otp: z.boolean(),
    username_password: z.boolean(),
    email_password: z.boolean(),
    email_otp: z.boolean(),
    google: z.boolean(),
  })
  .refine(
    (value) => Object.values(value).some(Boolean),
    "حداقل یک روش ورود لازم است.",
  );
export type LoginMethods = z.infer<typeof loginMethodsSchema>;

export const profileFieldSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .refine(
      (key) =>
        ![
          "__proto__",
          "constructor",
          "prototype",
          "password",
          "token",
          "tenant_id",
        ].includes(key),
    ),
  label: z.string().trim().min(1).max(80),
  type: z.enum([
    "TEXT",
    "TEXTAREA",
    "NUMBER",
    "SELECT",
    "MULTI_SELECT",
    "CHECKBOX",
    "DATE",
  ]),
  required: z.boolean(),
  enabled: z.boolean(),
  order: z.number().int().min(0).max(39),
  helperText: z.string().max(240).default(""),
  placeholder: z.string().max(120).default(""),
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  showDuringSignup: z.boolean(),
  showInProfile: z.boolean(),
  userEditable: z.boolean(),
  adminVisible: z.boolean(),
});
export type ProfileField = z.infer<typeof profileFieldSchema>;
export const profileFieldsSchema = z
  .array(profileFieldSchema)
  .min(3)
  .max(40)
  .superRefine((fields, ctx) => {
    if (new Set(fields.map((field) => field.key)).size !== fields.length)
      ctx.addIssue({ code: "custom", message: "Duplicate field keys" });
    for (const key of ["first_name", "last_name", "mobile"]) {
      const field = fields.find((entry) => entry.key === key);
      if (
        !field ||
        !field.enabled ||
        !field.required ||
        !field.showDuringSignup ||
        field.type !== "TEXT"
      )
        ctx.addIssue({ code: "custom", message: `Protected field: ${key}` });
    }
    for (const field of fields) {
      if (
        ["SELECT", "MULTI_SELECT"].includes(field.type) &&
        (!field.options.length ||
          new Set(field.options).size !== field.options.length)
      )
        ctx.addIssue({
          code: "custom",
          message: "Selection options are invalid",
        });
      if (
        field.required &&
        field.enabled &&
        !field.showDuringSignup &&
        !["mobile"].includes(field.key)
      )
        ctx.addIssue({
          code: "custom",
          message: "Required fields must be available during signup",
        });
    }
  });
const builtins = {
  first_name: "نام",
  last_name: "نام خانوادگی",
  mobile: "موبایل",
  city: "شهر",
  province: "استان",
  occupation: "شغل",
  workplace: "محل کار",
  job_title: "عنوان شغلی",
  education_level: "تحصیلات",
  field_of_study: "رشته تحصیلی",
  national_id: "کد ملی",
};
export const defaultProfileFields: ProfileField[] = Object.entries(
  builtins,
).map(([key, label], order) => ({
  key,
  label,
  order,
  type: "TEXT",
  required: order < 3,
  enabled: order < 3,
  helperText: "",
  placeholder: "",
  options: [],
  showDuringSignup: true,
  showInProfile: true,
  userEditable: true,
  adminVisible: true,
}));

export function validateProfileValues(
  fields: ProfileField[],
  input: unknown,
  mode: "signup" | "profile",
): Record<string, string | number | boolean | string[]> {
  const values = z.record(z.string(), z.unknown()).parse(input);
  if (Object.keys(values).length > 40 || JSON.stringify(values).length > 20000)
    throw new Error("Profile values exceed limits");
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = fields.find(
      (entry) =>
        entry.key === key &&
        entry.enabled &&
        (mode === "signup"
          ? entry.showDuringSignup
          : entry.showInProfile && entry.userEditable),
    );
    if (!field || (mode === "profile" && key === "mobile"))
      throw new Error("This field cannot be edited");
    if (!field.required && value === "" && field.type === "NUMBER") {
      result[key] = "";
      continue;
    }
    if (field.type === "CHECKBOX") result[key] = z.boolean().parse(value);
    else if (field.type === "NUMBER")
      result[key] = z.number().finite().min(-1e12).max(1e12).parse(value);
    else if (field.type === "MULTI_SELECT")
      result[key] = z
        .array(z.string())
        .max(30)
        .refine((entries) =>
          entries.every((entry) => field.options.includes(entry)),
        )
        .parse(value);
    else {
      const text = z
        .string()
        .trim()
        .max(
          ["first_name", "last_name"].includes(key)
            ? 59
            : field.type === "TEXTAREA"
              ? 2000
              : 500,
        )
        .parse(value);
      if (field.type === "SELECT" && text && !field.options.includes(text))
        throw new Error("Invalid option");
      if (
        field.type === "DATE" &&
        text &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
          !Number.isFinite(Date.parse(text)) ||
          new Date(text).toISOString().slice(0, 10) !== text)
      )
        throw new Error("Invalid date");
      if (key === "national_id" && text && !/^\d{10}$/.test(text))
        throw new Error("Invalid national ID");
      result[key] = key === "mobile" ? normalizeIranianPhone(text) : text;
    }
  }
  for (const field of fields.filter(
    (entry) =>
      entry.enabled &&
      entry.required &&
      (mode === "signup"
        ? entry.showDuringSignup
        : entry.showInProfile && entry.userEditable && entry.key !== "mobile"),
  )) {
    if (
      result[field.key] === undefined ||
      result[field.key] === "" ||
      result[field.key] === false ||
      (Array.isArray(result[field.key]) &&
        !(result[field.key] as string[]).length)
    )
      throw new Error(`${field.label} لازم است.`);
  }
  return result;
}
