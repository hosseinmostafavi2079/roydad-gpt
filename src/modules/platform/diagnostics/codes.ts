export const diagnosticCodes = {
  CONTROL_DB_UNAVAILABLE: {
    component: "CONTROL_DATABASE",
    severity: "CRITICAL",
    summary: "پایگاه داده کنترل در دسترس نیست.",
    cause: "اتصال برنامه به PostgreSQL با خطا مواجه شده است.",
    checks: ["سلامت PostgreSQL", "اتصال پایگاه داده", "تغییرات اخیر زیرساخت"],
  },
  TENANT_PROVISIONING_FAILED: {
    component: "TENANT_PROVISIONING",
    severity: "ERROR",
    summary: "راه‌اندازی سازمان ناموفق بود.",
    cause: "یکی از مراحل راه‌اندازی سازمان تکمیل نشده است.",
    checks: [
      "وضعیت درخواست راه‌اندازی",
      "وضعیت مهاجرت پایگاه داده سازمان",
      "گزارش امن worker",
    ],
  },
  BACKUP_FAILED: {
    component: "BACKUP_SYSTEM",
    severity: "ERROR",
    summary: "تهیه بکاپ ناموفق بود.",
    cause: "اجرا یا بررسی بکاپ تکمیل نشده است.",
    checks: ["فضای ذخیره‌سازی بکاپ", "وضعیت درخواست بکاپ", "گزارش امن اجرا"],
  },
  BACKUP_VERIFY_FAILED: {
    component: "BACKUP_SYSTEM",
    severity: "ERROR",
    summary: "بررسی صحت بکاپ ناموفق بود.",
    cause: "آرشیو یا checksum تأیید نشده است.",
    checks: ["فضای ذخیره‌سازی", "صحت آرشیو و checksum", "گزارش امن اجرا"],
  },
  SMS_PROVIDER_TIMEOUT: {
    component: "SMS",
    severity: "WARNING",
    summary: "پاسخ سرویس پیامک به موقع دریافت نشد.",
    cause: "اختلال سرویس یا شبکه محتمل است.",
    checks: ["دسترسی سرویس پیامک", "تنظیمات پیامک سازمان", "وضعیت تلاش مجدد"],
  },
  PAYMENT_RECONCILIATION_FAILED: {
    component: "PAYMENTS",
    severity: "ERROR",
    summary: "تطبیق پرداخت ناموفق بود.",
    cause: "پردازش وضعیت پرداخت تکمیل نشده است.",
    checks: ["worker پرداخت", "دسترسی ارائه‌دهنده", "وضعیت تطبیق تراکنش"],
  },
} as const;
export type DiagnosticCode = keyof typeof diagnosticCodes;
