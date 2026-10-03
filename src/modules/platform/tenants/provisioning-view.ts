export const provisioningStateLabels: Readonly<Record<string, string>> = {
  REQUESTED: "در حال ثبت مجموعه",
  DATABASE_CREATING: "در حال ایجاد پایگاه داده",
  MIGRATING: "در حال اجرای ساختار پایگاه داده",
  SEEDING: "در حال ایجاد دسترسی‌ها، دعوت مدیر و آماده‌سازی وب‌سایت",
  VERIFYING: "در حال بررسی سلامت",
  ACTIVE: "آماده استفاده",
  FAILED_DATABASE: "خطا در ساخت پایگاه داده",
  FAILED_MIGRATION: "خطا در اعمال تغییرات",
  FAILED_SEED: "خطا در داده‌های پایه",
  FAILED_VERIFICATION: "بررسی نهایی ناموفق",
};
export const provisioningProgressStates = [
  "REQUESTED",
  "DATABASE_CREATING",
  "MIGRATING",
  "SEEDING",
  "VERIFYING",
  "ACTIVE",
] as const;
