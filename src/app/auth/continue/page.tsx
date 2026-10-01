import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { getTenantAuth } from "@/modules/tenant-identity/auth";
import {
  roleAwareTenantDestination,
  safeParticipantDestination,
} from "@/modules/tenant-identity/auth-destination";
import { resolveTenantFromHeaders } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";

export const dynamic = "force-dynamic";

export default async function AuthContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const requestHeaders = await headers();
  let context: Awaited<ReturnType<typeof resolveTenantFromHeaders>>;
  try {
    context = await resolveTenantFromHeaders(requestHeaders);
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const session = await getTenantAuth(
    context.tenant,
    context.origin,
  ).api.getSession({
    headers: requestHeaders,
  });
  const next = safeParticipantDestination((await searchParams).next);
  if (!session)
    redirect(
      `/login?mode=login${next ? `&next=${encodeURIComponent(next)}` : ""}`,
    );

  const roles = await getTenantPool(context.tenant).query<{ code: string }>(
    `SELECT role.code FROM tenant_user_roles AS assignment
     JOIN tenant_roles AS role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id
     WHERE assignment.tenant_id=$1 AND assignment.user_id=$2`,
    [context.tenant.tenantId, session.user.id],
  );
  redirect(
    roleAwareTenantDestination(
      roles.rows.map((role) => role.code),
      next,
    ),
  );
}
