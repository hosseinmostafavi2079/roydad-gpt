import { PlatformAdminsCenter } from "@/app/_components/platform-admins-center";
import { requirePlatformPageAdmin } from "@/infrastructure/auth/platform-session";
export const metadata = { title: "مدیران پلتفرم" };
export default async function PlatformAdminsPage() {
  await requirePlatformPageAdmin();
  return <PlatformAdminsCenter />;
}
