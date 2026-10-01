import { redirect } from "next/navigation";
import { safeParticipantDestination } from "@/modules/tenant-identity/auth-destination";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeParticipantDestination((await searchParams).next);
  redirect(
    `/login?mode=register${next ? `&next=${encodeURIComponent(next)}` : ""}`,
  );
}
