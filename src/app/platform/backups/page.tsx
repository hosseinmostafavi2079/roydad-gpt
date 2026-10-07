import { BackupCenter } from "@/app/_components/backup-center";
import { requirePlatformPageAdmin } from "@/infrastructure/auth/platform-session";

export const metadata = { title: "پشتیبان‌گیری" };

export default async function BackupsPage() {
  await requirePlatformPageAdmin();
  return <BackupCenter />;
}
