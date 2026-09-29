import "server-only";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { getWebsiteProfile } from "./profile";

export async function publicPageContext() {
  try {
    const context = await resolveTenantFromHeaders(await headers());
    if (!context.tenant.features.public_website) notFound();
    const profile = await getWebsiteProfile(context.tenant);
    return { ...context, profile };
  } catch {
    notFound();
  }
}
