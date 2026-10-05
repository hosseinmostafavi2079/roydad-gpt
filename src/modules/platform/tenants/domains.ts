import "server-only";

import type { PoolClient } from "pg";
import type { PlatformActor } from "@/infrastructure/auth/platform-session";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { newDomainChallenge } from "@/modules/tenants/domain-verification";
import { invalidateTenantResolutionCache } from "@/modules/tenants/resolver";
import { DomainError } from "@/shared/errors/domain-error";

// All domain mutations serialize on the tenant row, including additions/quota checks.
export async function lockDomainTenant(
  client: PoolClient,
  tenantId: string,
): Promise<void> {
  const result = await client.query(
    "SELECT id FROM tenants WHERE id=$1 FOR UPDATE",
    [tenantId],
  );
  if (!result.rowCount)
    throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
}

export async function issueDomainVerification(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    await lockDomainTenant(client, tenantId);
    const result = await client.query<{
      hostname: string;
      verified_at: Date | null;
    }>(
      "SELECT hostname,verified_at FROM tenant_domains WHERE id=$1 AND tenant_id=$2 AND domain_type='CUSTOM' FOR UPDATE",
      [domainId, tenantId],
    );
    const domain = result.rows[0];
    if (!domain)
      throw new DomainError("NOT_FOUND", "The custom domain was not found.");
    if (domain.verified_at)
      throw new DomainError("CONFLICT", "This domain is already verified.");
    const challenge = newDomainChallenge(domain.hostname);
    const updated = await client.query<{ verification_expires_at: Date }>(
      "UPDATE tenant_domains SET verification_token_hash=$3,verification_expires_at=now()+interval '24 hours' WHERE id=$1 AND tenant_id=$2 RETURNING verification_expires_at",
      [domainId, tenantId, challenge.hash],
    );
    const expiry = updated.rows[0];
    if (!expiry) throw new Error("Domain challenge update returned no row.");
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "domain.verification_issued",
      targetType: "TENANT_DOMAIN",
      targetId: domainId,
      requestId,
      afterState: {
        tenantId,
        hostname: domain.hostname,
        expiresAt: expiry.verification_expires_at.toISOString(),
      },
    });
    return {
      ...challenge.verification,
      expiresAt: expiry.verification_expires_at.toISOString(),
    };
  });
}

export async function makeDomainPrimary(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
  requestId: string,
) {
  const result = await withControlTransaction(async (client) => {
    await lockDomainTenant(client, tenantId);
    const domains = await client.query<{
      id: string;
      hostname: string;
      domain_type: string;
      verified_at: Date | null;
      is_primary: boolean;
    }>(
      "SELECT id,hostname,domain_type,verified_at,is_primary FROM tenant_domains WHERE tenant_id=$1 FOR UPDATE",
      [tenantId],
    );
    const target = domains.rows.find((domain) => domain.id === domainId);
    if (!target)
      throw new DomainError(
        "NOT_FOUND",
        "The domain was not found for this tenant.",
      );
    if (!target.verified_at)
      throw new DomainError(
        "DOMAIN_UNVERIFIED",
        "Verify this domain before making it primary.",
      );
    if (target.is_primary)
      return { id: target.id, hostname: target.hostname, isPrimary: true };
    const previous = domains.rows.find((domain) => domain.is_primary);
    await client.query(
      "UPDATE tenant_domains SET is_primary=false WHERE tenant_id=$1 AND is_primary",
      [tenantId],
    );
    await client.query(
      "UPDATE tenant_domains SET is_primary=true WHERE tenant_id=$1 AND id=$2",
      [tenantId, domainId],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "domain.primary_changed",
      targetType: "TENANT_DOMAIN",
      targetId: domainId,
      requestId,
      beforeState: { tenantId, hostname: previous?.hostname ?? null },
      afterState: { tenantId, hostname: target.hostname },
    });
    return { id: target.id, hostname: target.hostname, isPrimary: true };
  });
  invalidateTenantResolutionCache(tenantId);
  return result;
}

export async function removeTenantDomain(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
  requestId: string,
) {
  const result = await withControlTransaction(async (client) => {
    await lockDomainTenant(client, tenantId);
    const domains = await client.query<{
      id: string;
      hostname: string;
      is_primary: boolean;
      verified_at: Date | null;
    }>(
      "SELECT id,hostname,is_primary,verified_at FROM tenant_domains WHERE tenant_id=$1 FOR UPDATE",
      [tenantId],
    );
    const target = domains.rows.find((domain) => domain.id === domainId);
    if (!target)
      throw new DomainError(
        "NOT_FOUND",
        "The domain was not found for this tenant.",
      );
    if (
      target.is_primary ||
      !domains.rows.some(
        (domain) =>
          domain.id !== domainId && domain.is_primary && domain.verified_at,
      )
    )
      throw new DomainError(
        "CONFLICT",
        "Keep a verified primary domain; switch primary before removing this domain.",
      );
    await client.query(
      "DELETE FROM tenant_domains WHERE id=$1 AND tenant_id=$2",
      [domainId, tenantId],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "domain.removed",
      targetType: "TENANT_DOMAIN",
      targetId: domainId,
      requestId,
      beforeState: {
        tenantId,
        hostname: target.hostname,
        verified: Boolean(target.verified_at),
      },
    });
    return { removed: true };
  });
  invalidateTenantResolutionCache(tenantId);
  return result;
}
