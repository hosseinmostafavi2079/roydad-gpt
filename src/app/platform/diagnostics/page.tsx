import { DiagnosticsCenter } from "@/app/_components/diagnostics-center";
import { requirePlatformPageAdmin } from "@/infrastructure/auth/platform-session";
export const metadata = { title: "عیب‌یابی و سلامت سیستم" };
export default async function DiagnosticsPage() {
  await requirePlatformPageAdmin();
  return <DiagnosticsCenter />;
}
