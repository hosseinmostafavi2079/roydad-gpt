import { CalendarManager } from "@/app/_components/calendar-manager";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function CalendarPage() {
  const { tenant } = await requireTenantPage("session.read");
  return <CalendarManager timezone={tenant.timezone} />;
}
