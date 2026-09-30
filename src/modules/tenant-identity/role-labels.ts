export const SYSTEM_ROLE_LABELS: Readonly<Record<string, string>> = {
  organization_owner: "مالک مجموعه",
  organization_admin: "مدیر مجموعه",
  course_manager: "مدیر دوره‌ها",
  instructor: "مدرس",
  attendance_officer: "مسئول حضور و غیاب",
  finance: "امور مالی",
  content_manager: "مدیر محتوا",
  analyst: "تحلیل‌گر / گزارش‌گیر",
  reception: "پذیرش",
  support: "پشتیبانی",
  participant: "شرکت‌کننده",
};

export function roleLabel(code: string, name?: string): string {
  return SYSTEM_ROLE_LABELS[code] ?? name ?? code;
}
