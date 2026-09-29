import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getServerConfig } from "@/shared/config/env";
import { normalizeHostHeader } from "@/modules/tenants/host";
import { resolveTenantContext } from "@/modules/tenants/resolver";

export const dynamic = "force-dynamic";

export default async function Home() {
  const hostHeader = (await headers()).get("host");
  if (!hostHeader) notFound();
  let hostname: string;
  try {
    hostname = normalizeHostHeader(hostHeader);
  } catch {
    notFound();
  }
  const config = getServerConfig();
  const platformHost = new URL(config.BETTER_AUTH_URL).hostname.toLowerCase();
  if (hostname === platformHost || hostname === config.PLATFORM_BASE_DOMAIN) {
    redirect("/platform");
  }
  try {
    await resolveTenantContext(hostHeader);
  } catch {
    notFound();
  }
  redirect("/dashboard");
}
