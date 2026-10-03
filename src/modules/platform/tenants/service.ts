import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { DomainError } from "@/shared/errors/domain-error";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import { getServerConfig } from "@/shared/config/env";
import { encryptTenantOwnerBootstrap } from "@/infrastructure/auth/tenant-bootstrap";
import {
  featureSetSchema,
  limitSetSchema,
  type FeatureKey,
  type LimitKey,
} from "@/modules/platform/plans/schema";
import { enqueueProvisioningInTransaction } from "@/modules/platform/provisioning/queue";
import { normalizeCustomDomain } from "@/modules/tenants/host";
import type { PlatformActor } from "@/infrastructure/auth/platform-session";
import type {
  CreateDomainInput,
  CreateTenantInput,
  UpdateBrandingInput,
  UpdateTenantInput,
} from "@/modules/platform/tenants/schema";
import type { FeatureSet, LimitSet } from "@/modules/platform/plans/schema";

type TenantSummaryRow = {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  status: string;
  plan_code: string;
  plan_name: string;
  primary_hostname: string | null;
  provisioning_state: string | null;
  health_state: string;
  created_at: Date;
};

type TenantConfigurationRow = {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  status: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  locale: string;
  timezone: string;
  database_name: string;
  migration_version: string | null;
  last_health_state: string;
  plan_features: Record<string, unknown>;
  plan_limits: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type ProvisioningRow = {
  id: string;
  state: string;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  request_id: string;
  created_at: Date;
  updated_at: Date;
};

function tenantSummaryDto(row: TenantSummaryRow) {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legal_name,
    displayName: row.display_name,
    status: row.status,
    plan: { code: row.plan_code, name: row.plan_name },
    primaryHostname: row.primary_hostname,
    provisioningState: row.provisioning_state,
    health: row.health_state === "UNAVAILABLE" ? "FAILED" : row.health_state,
    createdAt: row.created_at.toISOString(),
  };
}

function validatePlanDefaults(
  features: Record<string, unknown>,
  limits: Record<string, unknown>,
) {
  const parsedFeatures = featureSetSchema.safeParse(features);
  const parsedLimits = limitSetSchema.safeParse(limits);
  if (!parsedFeatures.success || !parsedLimits.success) {
    throw new Error("A plan contains invalid feature or limit defaults.");
  }
  return { features: parsedFeatures.data, limits: parsedLimits.data };
}

async function tenantPlanDefaults(
  client: import("pg").PoolClient,
  tenantId: string,
) {
  const result = await client.query<{
    features: Record<string, unknown>;
    limits: Record<string, unknown>;
  }>(
    `SELECT plans.features, plans.limits
     FROM tenants JOIN plans ON plans.id = tenants.plan_id
     WHERE tenants.id = $1 FOR SHARE OF tenants, plans`,
    [tenantId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
  }
  return validatePlanDefaults(row.features, row.limits);
}

async function currentTenantOverrides(
  client: import("pg").PoolClient,
  tenantId: string,
) {
  const [featureRows, limitRows] = await Promise.all([
    client.query<{ feature_key: FeatureKey; enabled: boolean }>(
      "SELECT feature_key, enabled FROM tenant_features WHERE tenant_id = $1",
      [tenantId],
    ),
    client.query<{ limit_key: LimitKey; limit_value: number }>(
      "SELECT limit_key, limit_value FROM tenant_limits WHERE tenant_id = $1",
      [tenantId],
    ),
  ]);
  return {
    features: Object.fromEntries(
      featureRows.rows.map((row) => [row.feature_key, row.enabled]),
    ) as Partial<FeatureSet>,
    limits: Object.fromEntries(
      limitRows.rows.map((row) => [row.limit_key, row.limit_value]),
    ) as Partial<LimitSet>,
  };
}

export async function createTenant(
  input: CreateTenantInput,
  actor: PlatformActor,
  requestId: string,
) {
  const config = getServerConfig();
  const tenantId = randomUUID();
  const databaseName = `eventos_t_${tenantId.replaceAll("-", "")}`;
  const hostname = `${input.slug}.${config.PLATFORM_BASE_DOMAIN}`;
  const creationKey = input.creationKey ?? null;
  const primaryColor = input.primaryColor ?? "#145D58";
  const preset = input.preset ?? "SIMPLE";
  const payloadHash = creationKey
    ? createHash("sha256")
        .update(
          JSON.stringify({
            slug: input.slug,
            legalName: input.legalName || input.displayName,
            displayName: input.displayName,
            planCode: input.planCode,
            ownerName: input.ownerName,
            ownerEmail: input.ownerEmail,
            primaryColor,
            preset,
            featureOverrides: input.featureOverrides ?? [],
            limitOverrides: input.limitOverrides ?? [],
          }),
        )
        .digest("hex")
    : null;
  if (hostname.length > 253) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The tenant subdomain is too long.",
    );
  }

  try {
    return await withControlTransaction(async (client) => {
      if (creationKey) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`tenant-create:${actor.adminId}:${creationKey}`],
        );
        const prior = await client.query<{
          id: string;
          slug: string;
          legal_name: string;
          display_name: string;
          status: string;
          created_at: Date;
          creation_payload_hash: string;
          plan_code: string;
          plan_name: string;
          job_id: string;
        }>(
          `SELECT tenant.id, tenant.slug, tenant.legal_name, tenant.display_name,
                  tenant.status, tenant.created_at, tenant.creation_payload_hash,
                  plan.code AS plan_code, plan.name AS plan_name, job.id AS job_id
           FROM tenants AS tenant JOIN plans AS plan ON plan.id = tenant.plan_id
           JOIN LATERAL (SELECT id FROM provisioning_jobs WHERE tenant_id = tenant.id
                         ORDER BY created_at DESC LIMIT 1) AS job ON true
           WHERE tenant.created_by = $1 AND tenant.creation_request_key = $2`,
          [actor.adminId, creationKey],
        );
        const previous = prior.rows[0];
        if (previous) {
          if (previous.creation_payload_hash !== payloadHash) {
            throw new DomainError(
              "CONFLICT",
              "This creation request was already used for different details.",
            );
          }
          return {
            tenant: {
              id: previous.id,
              slug: previous.slug,
              legalName: previous.legal_name,
              displayName: previous.display_name,
              status: previous.status,
              plan: { code: previous.plan_code, name: previous.plan_name },
              primaryHostname: `${previous.slug}.${config.PLATFORM_BASE_DOMAIN}`,
              createdAt: previous.created_at.toISOString(),
            },
            provisioning: { jobId: previous.job_id, state: previous.status },
          };
        }
      }
      const planResult = await client.query<{
        id: string;
        code: string;
        name: string;
      }>(
        "SELECT id, code, name FROM plans WHERE code = $1 AND is_active FOR SHARE",
        [input.planCode],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        throw new DomainError("VALIDATION_FAILED", "Choose an active plan.");
      }

      const tenantResult = await client.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, plan_id, created_by,
                              creation_request_key, creation_payload_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id, slug, legal_name, display_name, status, created_at`,
        [
          tenantId,
          input.slug,
          input.legalName || input.displayName,
          input.displayName,
          plan.id,
          actor.adminId,
          creationKey,
          payloadHash,
          JSON.stringify({ preset }),
        ],
      );
      const tenant = tenantResult.rows[0] as
        | {
            id: string;
            slug: string;
            legal_name: string;
            display_name: string;
            status: string;
            created_at: Date;
          }
        | undefined;
      if (!tenant) {
        throw new Error("Tenant creation did not return a row.");
      }

      await client.query(
        "INSERT INTO tenant_database_registry (tenant_id, database_name) VALUES ($1, $2)",
        [tenantId, databaseName],
      );
      await client.query(
        `INSERT INTO tenant_domains (tenant_id, hostname, domain_type, is_primary, verified_at, created_by)
         VALUES ($1, $2, 'PLATFORM_SUBDOMAIN', true, now(), $3)`,
        [tenantId, hostname, actor.adminId],
      );
      await client.query(
        `INSERT INTO tenant_branding (tenant_id, brand_name, primary_color, updated_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, input.displayName, primaryColor, actor.adminId],
      );
      for (const override of input.featureOverrides ?? []) {
        if (override.enabled !== null)
          await client.query(
            `INSERT INTO tenant_features (tenant_id, feature_key, enabled, updated_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, feature_key)
           DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by`,
            [tenantId, override.key, override.enabled, actor.adminId],
          );
      }
      for (const override of input.limitOverrides ?? []) {
        if (override.value !== null)
          await client.query(
            `INSERT INTO tenant_limits (tenant_id, limit_key, limit_value, updated_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, limit_key)
           DO UPDATE SET limit_value = EXCLUDED.limit_value, updated_by = EXCLUDED.updated_by`,
            [tenantId, override.key, override.value, actor.adminId],
          );
      }

      const jobResult = await client.query<{ id: string }>(
        `INSERT INTO provisioning_jobs
           (tenant_id, idempotency_key, requested_by, request_id, owner_bootstrap_ciphertext)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          tenantId,
          `tenant-provision:${tenantId}`,
          actor.adminId,
          requestId,
          encryptTenantOwnerBootstrap(tenantId, {
            name: input.ownerName,
            email: input.ownerEmail,
          }),
        ],
      );
      const job = jobResult.rows[0];
      if (!job) {
        throw new Error("Provisioning job creation did not return a row.");
      }

      await client.query(
        `INSERT INTO provisioning_job_transitions
           (job_id, sequence_number, from_state, to_state, actor_id, request_id)
         VALUES ($1, 1, NULL, 'REQUESTED', $2, $3)`,
        [job.id, actor.adminId, requestId],
      );
      const queueJobId = await enqueueProvisioningInTransaction(client, {
        jobId: job.id,
        tenantId,
      });
      await client.query(
        "UPDATE provisioning_jobs SET queue_job_id = $2 WHERE id = $1",
        [job.id, queueJobId],
      );
      await appendAuditRecord(client, {
        actorType: "PLATFORM_ADMIN",
        actorId: actor.adminId,
        action: "tenant.created",
        targetType: "TENANT",
        targetId: tenantId,
        requestId,
        afterState: {
          slug: tenant.slug,
          legalName: tenant.legal_name,
          displayName: tenant.display_name,
          status: tenant.status,
          planCode: plan.code,
          hostname,
          provisioningJobId: job.id,
        },
      });
      await appendAuditRecord(client, {
        actorType: "PLATFORM_ADMIN",
        actorId: actor.adminId,
        action: "tenant.creation_requested",
        targetType: "TENANT",
        targetId: tenantId,
        requestId,
        afterState: {
          slug: tenant.slug,
          planCode: plan.code,
          provisioningJobId: job.id,
        },
      });

      return {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          legalName: tenant.legal_name,
          displayName: tenant.display_name,
          status: tenant.status,
          plan: { code: plan.code, name: plan.name },
          primaryHostname: hostname,
          createdAt: tenant.created_at.toISOString(),
        },
        provisioning: { jobId: job.id, state: "REQUESTED" },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError(
        "CONFLICT",
        "A tenant with this slug or hostname already exists.",
        { cause: error },
      );
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function listTenants(input: {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "FAILED" | undefined;
  plan?: string | undefined;
}) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (input.status) {
    values.push(input.status);
    conditions.push(`tenant.status = $${values.length}`);
  }
  if (input.plan) {
    values.push(input.plan);
    conditions.push(`plan.code = $${values.length}`);
  }
  if (input.search) {
    const search = input.search.replace(/[\\%_]/g, "\\$&");
    values.push(`%${search}%`);
    const parameter = `$${values.length}`;
    conditions.push(
      `(tenant.slug ILIKE ${parameter} ESCAPE '\\' OR tenant.display_name ILIKE ${parameter} ESCAPE '\\')`,
    );
  }

  values.push(input.pageSize, (input.page - 1) * input.pageSize);
  const limitIndex = values.length - 1;
  const offsetIndex = values.length;
  const result = await getControlPool().query<
    TenantSummaryRow & { total_count: string }
  >(
    `SELECT tenant.id, tenant.slug, tenant.legal_name, tenant.display_name, tenant.status,
            plan.code AS plan_code, plan.name AS plan_name,
            (SELECT hostname FROM tenant_domains WHERE tenant_id = tenant.id AND is_primary AND verified_at IS NOT NULL) AS primary_hostname,
            latest_job.state AS provisioning_state,
            COALESCE(registry.last_health_state, 'FAILED') AS health_state,
            tenant.created_at,
            count(*) OVER()::text AS total_count
     FROM tenants AS tenant
     JOIN plans AS plan ON plan.id = tenant.plan_id
     LEFT JOIN tenant_database_registry AS registry ON registry.tenant_id = tenant.id
     LEFT JOIN LATERAL (
       SELECT state FROM provisioning_jobs WHERE tenant_id = tenant.id ORDER BY created_at DESC LIMIT 1
     ) AS latest_job ON true
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY tenant.created_at DESC, tenant.id ASC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values,
  );
  const total = Number(result.rows[0]?.total_count ?? 0);
  return {
    items: result.rows.map(tenantSummaryDto),
    page: input.page,
    pageSize: input.pageSize,
    total,
    pageCount: Math.ceil(total / input.pageSize),
  };
}

const tenantSelect = `
  SELECT tenant.id, tenant.slug, tenant.legal_name, tenant.display_name, tenant.status,
         tenant.plan_id, plan.code AS plan_code, plan.name AS plan_name,
         tenant.locale, tenant.timezone, database.database_name, database.migration_version,
         database.last_health_state, plan.features AS plan_features, plan.limits AS plan_limits,
         tenant.created_at, tenant.updated_at
  FROM tenants AS tenant
  JOIN plans AS plan ON plan.id = tenant.plan_id
  JOIN tenant_database_registry AS database ON database.tenant_id = tenant.id
`;

export async function getTenantDetails(tenantId: string) {
  const client = await getControlPool().connect();
  try {
    const integrity = await client.query<{
      plan_exists: boolean;
      registry_exists: boolean;
      branding_exists: boolean;
      primary_domain_exists: boolean;
    }>(
      `SELECT plan.id IS NOT NULL AS plan_exists,
              registry.tenant_id IS NOT NULL AS registry_exists,
              branding.tenant_id IS NOT NULL AS branding_exists,
              EXISTS (SELECT 1 FROM tenant_domains AS domain
                      WHERE domain.tenant_id = tenant.id AND domain.is_primary)
                AS primary_domain_exists
       FROM tenants AS tenant
       LEFT JOIN plans AS plan ON plan.id = tenant.plan_id
       LEFT JOIN tenant_database_registry AS registry ON registry.tenant_id = tenant.id
       LEFT JOIN tenant_branding AS branding ON branding.tenant_id = tenant.id
       WHERE tenant.id = $1`,
      [tenantId],
    );
    const relationships = integrity.rows[0];
    if (!relationships)
      throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
    if (
      !relationships.plan_exists ||
      !relationships.registry_exists ||
      !relationships.branding_exists ||
      !relationships.primary_domain_exists
    ) {
      throw new DomainError(
        "PROVISIONING_FAILED",
        "Tenant control data is incomplete.",
      );
    }
    const tenantResult = await client.query<TenantConfigurationRow>(
      `${tenantSelect} WHERE tenant.id = $1`,
      [tenantId],
    );
    const row = tenantResult.rows[0];
    if (!row) {
      throw new DomainError(
        "PROVISIONING_FAILED",
        "Tenant control data changed during the request.",
      );
    }

    const [
      domainsResult,
      featureResult,
      limitResult,
      brandingResult,
      provisioningResult,
      auditResult,
    ] = await Promise.all([
      client.query<{
        id: string;
        hostname: string;
        domain_type: string;
        is_primary: boolean;
        verified_at: Date | null;
        verification_expires_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, hostname, domain_type, is_primary, verified_at, verification_expires_at, created_at
         FROM tenant_domains WHERE tenant_id = $1 ORDER BY is_primary DESC, hostname ASC`,
        [tenantId],
      ),
      client.query<{ feature_key: string; enabled: boolean }>(
        "SELECT feature_key, enabled FROM tenant_features WHERE tenant_id = $1 ORDER BY feature_key",
        [tenantId],
      ),
      client.query<{ limit_key: string; limit_value: number }>(
        "SELECT limit_key, limit_value FROM tenant_limits WHERE tenant_id = $1 ORDER BY limit_key",
        [tenantId],
      ),
      client.query<{
        brand_name: string;
        logo_asset_key: string | null;
        primary_color: string;
        accent_color: string;
      }>(
        "SELECT brand_name, logo_asset_key, primary_color, accent_color FROM tenant_branding WHERE tenant_id = $1",
        [tenantId],
      ),
      client.query<ProvisioningRow>(
        `SELECT id, state, attempt_count, error_code, error_message, request_id, created_at, updated_at
         FROM provisioning_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [tenantId],
      ),
      client.query<{
        id: string;
        action: string;
        actor_id: string | null;
        request_id: string;
        after_state: Record<string, unknown> | null;
        created_at: Date;
      }>(
        `SELECT id, action, actor_id, request_id, after_state, created_at
         FROM platform_audit_logs WHERE target_type = 'TENANT' AND target_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [tenantId],
      ),
    ]);

    const defaults = validatePlanDefaults(row.plan_features, row.plan_limits);
    const overrides = {
      features: Object.fromEntries(
        featureResult.rows.map((entry) => [entry.feature_key, entry.enabled]),
      ) as Partial<FeatureSet>,
      limits: Object.fromEntries(
        limitResult.rows.map((entry) => [entry.limit_key, entry.limit_value]),
      ) as Partial<LimitSet>,
    };
    const branding = brandingResult.rows[0];
    return {
      tenant: {
        id: row.id,
        slug: row.slug,
        legalName: row.legal_name,
        displayName: row.display_name,
        status: row.status,
        locale: row.locale,
        timezone: row.timezone,
        plan: { id: row.plan_id, code: row.plan_code, name: row.plan_name },
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      database: {
        state: row.last_health_state,
        migrationVersion: row.migration_version,
      },
      features: { ...defaults.features, ...overrides.features },
      featureOverrides: overrides.features,
      planFeatures: defaults.features,
      limits: { ...defaults.limits, ...overrides.limits },
      limitOverrides: overrides.limits,
      planLimits: defaults.limits,
      branding: branding
        ? {
            brandName: branding.brand_name,
            logoAssetKey: branding.logo_asset_key,
            primaryColor: branding.primary_color,
            accentColor: branding.accent_color,
          }
        : null,
      domains: domainsResult.rows.map((domain) => ({
        id: domain.id,
        hostname: domain.hostname,
        type: domain.domain_type,
        isPrimary: domain.is_primary,
        verifiedAt: domain.verified_at?.toISOString() ?? null,
        verificationExpiresAt:
          domain.verification_expires_at?.toISOString() ?? null,
        createdAt: domain.created_at.toISOString(),
      })),
      provisioning: provisioningResult.rows.map((job) => ({
        id: job.id,
        state: job.state,
        attemptCount: job.attempt_count,
        errorCode: job.error_code,
        errorMessage: job.error_message,
        requestId: job.request_id,
        createdAt: job.created_at.toISOString(),
        updatedAt: job.updated_at.toISOString(),
      })),
      audit: auditResult.rows.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorId: entry.actor_id,
        requestId: entry.request_id,
        after: entry.after_state,
        createdAt: entry.created_at.toISOString(),
      })),
    };
  } finally {
    client.release();
  }
}

export async function updateTenant(
  tenantId: string,
  input: UpdateTenantInput,
  actor: PlatformActor,
  requestId: string,
) {
  const fieldColumns = {
    legalName: "legal_name",
    displayName: "display_name",
    locale: "locale",
    timezone: "timezone",
  } as const;
  const updates = Object.entries(input).filter(
    (entry) => entry[1] !== undefined,
  ) as [keyof typeof fieldColumns, string][];
  return withControlTransaction(async (client) => {
    const beforeResult = await client.query(
      `SELECT legal_name, display_name, locale, timezone FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    const before = beforeResult.rows[0] as Record<string, unknown> | undefined;
    if (!before) {
      throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
    }
    const values: unknown[] = [tenantId];
    const fragments = updates.map(([field, value]) => {
      values.push(value);
      return `${fieldColumns[field]} = $${values.length}`;
    });
    const updated = await client.query(
      `UPDATE tenants SET ${fragments.join(", ")}, updated_at = now() WHERE id = $1
       RETURNING id, legal_name, display_name, locale, timezone, status, updated_at`,
      values,
    );
    const after = updated.rows[0] as Record<string, unknown> | undefined;
    if (!after) {
      throw new Error("Tenant update did not return a row.");
    }
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.updated",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState: before,
      afterState: after,
    });
    return after;
  });
}

export async function updateTenantPlan(
  tenantId: string,
  planCode: string,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const beforeResult = await client.query<{
      plan_id: string;
      plan_code: string;
      plan_name: string;
    }>(
      `SELECT tenant.plan_id, plan.code AS plan_code, plan.name AS plan_name
       FROM tenants AS tenant JOIN plans AS plan ON plan.id = tenant.plan_id
       WHERE tenant.id = $1 FOR UPDATE OF tenant`,
      [tenantId],
    );
    const before = beforeResult.rows[0];
    if (!before) {
      throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
    }
    const nextPlanResult = await client.query<{
      id: string;
      code: string;
      name: string;
    }>(
      "SELECT id, code, name FROM plans WHERE code = $1 AND is_active FOR SHARE",
      [planCode],
    );
    const nextPlan = nextPlanResult.rows[0];
    if (!nextPlan) {
      throw new DomainError("VALIDATION_FAILED", "Choose an active plan.");
    }
    await client.query(
      "UPDATE tenants SET plan_id = $2, updated_at = now() WHERE id = $1",
      [tenantId, nextPlan.id],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.plan_changed",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState: { planCode: before.plan_code, planName: before.plan_name },
      afterState: { planCode: nextPlan.code, planName: nextPlan.name },
    });
    return { plan: { code: nextPlan.code, name: nextPlan.name } };
  });
}

export async function updateTenantFeatures(
  tenantId: string,
  overrides: Array<{ key: FeatureKey; enabled: boolean | null }>,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    await tenantPlanDefaults(client, tenantId);
    const current = await currentTenantOverrides(client, tenantId);
    const beforeState: Record<string, boolean | null> = {};
    const afterState: Record<string, boolean | null> = {};
    for (const override of overrides) {
      beforeState[override.key] = current.features[override.key] ?? null;
      afterState[override.key] = override.enabled;
      if (override.enabled === null) {
        await client.query(
          "DELETE FROM tenant_features WHERE tenant_id = $1 AND feature_key = $2",
          [tenantId, override.key],
        );
        continue;
      }
      await client.query(
        `INSERT INTO tenant_features (tenant_id, feature_key, enabled, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, feature_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [tenantId, override.key, override.enabled, actor.adminId],
      );
    }
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.features_changed",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState,
      afterState,
    });
    return { features: afterState };
  });
}

export async function updateTenantLimits(
  tenantId: string,
  overrides: Array<{ key: LimitKey; value: number | null }>,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    await tenantPlanDefaults(client, tenantId);
    const current = await currentTenantOverrides(client, tenantId);
    const beforeState: Record<string, number | null> = {};
    const afterState: Record<string, number | null> = {};
    for (const override of overrides) {
      beforeState[override.key] = current.limits[override.key] ?? null;
      afterState[override.key] = override.value;
      if (override.value === null) {
        await client.query(
          "DELETE FROM tenant_limits WHERE tenant_id = $1 AND limit_key = $2",
          [tenantId, override.key],
        );
        continue;
      }
      await client.query(
        `INSERT INTO tenant_limits (tenant_id, limit_key, limit_value, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, limit_key)
         DO UPDATE SET limit_value = EXCLUDED.limit_value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [tenantId, override.key, override.value, actor.adminId],
      );
    }
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.limits_changed",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState,
      afterState,
    });
    return { limits: afterState };
  });
}

export async function updateTenantBranding(
  tenantId: string,
  input: UpdateBrandingInput,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const existing = await client.query(
      "SELECT brand_name, logo_asset_key, primary_color, accent_color FROM tenant_branding WHERE tenant_id = $1 FOR UPDATE",
      [tenantId],
    );
    const before = existing.rows[0] as Record<string, unknown> | undefined;
    if (!before) {
      throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
    }
    await client.query(
      `UPDATE tenant_branding
       SET brand_name = $2, logo_asset_key = $3, primary_color = $4, accent_color = $5,
           updated_by = $6, updated_at = now()
       WHERE tenant_id = $1`,
      [
        tenantId,
        input.brandName,
        input.logoAssetKey,
        input.primaryColor.toUpperCase(),
        input.accentColor.toUpperCase(),
        actor.adminId,
      ],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.branding_changed",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState: before,
      afterState: input,
    });
    return input;
  });
}

export async function changeTenantStatus(
  tenantId: string,
  status: "ACTIVE" | "SUSPENDED",
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const result = await client.query<{
      status: string;
      migration_version: string | null;
      last_health_state: string;
    }>(
      `SELECT tenant.status, database.migration_version, database.last_health_state
       FROM tenants AS tenant JOIN tenant_database_registry AS database ON database.tenant_id = tenant.id
       WHERE tenant.id = $1 FOR UPDATE OF tenant`,
      [tenantId],
    );
    const current = result.rows[0];
    if (!current) {
      throw new DomainError("NOT_FOUND", "The requested tenant was not found.");
    }
    const valid =
      (current.status === "ACTIVE" && status === "SUSPENDED") ||
      (current.status === "SUSPENDED" && status === "ACTIVE");
    if (!valid) {
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        `A tenant in ${current.status} cannot move to ${status}.`,
      );
    }
    if (
      status === "ACTIVE" &&
      (!current.migration_version ||
        ["UNAVAILABLE", "FAILED"].includes(current.last_health_state))
    ) {
      throw new DomainError(
        "PROVISIONING_FAILED",
        "The tenant database must be healthy before reactivation.",
      );
    }
    await client.query(
      `UPDATE tenants SET status = $2,
         suspended_at = CASE WHEN $3 THEN now() ELSE NULL END,
         updated_at = now()
       WHERE id = $1`,
      [tenantId, status, status === "SUSPENDED"],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action:
        status === "SUSPENDED" ? "tenant.suspended" : "tenant.reactivated",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState: { status: current.status },
      afterState: { status },
    });
    return { status };
  });
}

export async function retryProvisioning(
  tenantId: string,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const result = await client.query<
      ProvisioningRow & { queue_job_id: string | null; tenant_status: string }
    >(
      `SELECT job.id, job.state, job.attempt_count, job.error_code, job.error_message, job.request_id,
              job.created_at, job.updated_at, job.queue_job_id, tenant.status AS tenant_status
       FROM provisioning_jobs AS job JOIN tenants AS tenant ON tenant.id = job.tenant_id
       WHERE job.tenant_id = $1 ORDER BY job.created_at DESC LIMIT 1 FOR UPDATE OF job, tenant`,
      [tenantId],
    );
    const job = result.rows[0];
    if (!job) {
      throw new DomainError(
        "NOT_FOUND",
        "No provisioning job exists for this tenant.",
      );
    }
    if (!job.state.startsWith("FAILED_") || !job.queue_job_id) {
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Only a failed provisioning job can be retried.",
      );
    }

    const attemptCount = job.attempt_count + 1;
    const queueJobId = await enqueueProvisioningInTransaction(client, {
      jobId: job.id,
      tenantId,
      attemptCount,
    });
    await client.query(
      `UPDATE provisioning_jobs SET state = 'REQUESTED', error_code = NULL, error_message = NULL,
         queue_job_id = $2, attempt_count = $3, updated_at = now()
       WHERE id = $1`,
      [job.id, queueJobId, attemptCount],
    );
    await client.query(
      "UPDATE tenants SET status = 'PROVISIONING', updated_at = now() WHERE id = $1",
      [tenantId],
    );
    const count = await client.query<{ next_sequence: number }>(
      "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence FROM provisioning_job_transitions WHERE job_id = $1",
      [job.id],
    );
    await client.query(
      `INSERT INTO provisioning_job_transitions
         (job_id, sequence_number, from_state, to_state, actor_id, request_id, safe_detail)
       VALUES ($1, $2, $3, 'REQUESTED', $4, $5, '{"reason":"admin_retry"}'::jsonb)`,
      [
        job.id,
        count.rows[0]?.next_sequence ?? 1,
        job.state,
        actor.adminId,
        requestId,
      ],
    );
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.provisioning_retried",
      targetType: "TENANT",
      targetId: tenantId,
      requestId,
      beforeState: {
        provisioningState: job.state,
        tenantStatus: job.tenant_status,
      },
      afterState: {
        provisioningState: "REQUESTED",
        tenantStatus: "PROVISIONING",
      },
    });
    return { jobId: job.id, state: "REQUESTED" as const };
  });
}

export async function createCustomDomain(
  tenantId: string,
  input: CreateDomainInput,
  actor: PlatformActor,
  requestId: string,
) {
  const hostname = normalizeCustomDomain(input.hostname);
  const { PLATFORM_BASE_DOMAIN: baseDomain } = getServerConfig();
  if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Use tenant subdomains for the platform base domain.",
    );
  }
  const verificationToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256")
    .update(verificationToken)
    .digest("hex");
  try {
    return await withControlTransaction(async (client) => {
      const defaults = await tenantPlanDefaults(client, tenantId);
      const overrides = await currentTenantOverrides(client, tenantId);
      const features = { ...defaults.features, ...overrides.features };
      const limits = { ...defaults.limits, ...overrides.limits };
      if (!features.custom_domain) {
        throw new DomainError(
          "FEATURE_DISABLED",
          "Enable the custom-domain feature before adding a custom domain.",
        );
      }
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_domains
         WHERE tenant_id = $1 AND domain_type = 'CUSTOM'`,
        [tenantId],
      );
      if ((count.rows[0]?.count ?? 0) >= limits.max_custom_domains) {
        throw new DomainError(
          "LIMIT_REACHED",
          "The custom-domain limit has been reached.",
        );
      }
      if (input.isPrimary) {
        throw new DomainError(
          "DOMAIN_UNVERIFIED",
          "Verify a custom domain before making it primary.",
        );
      }
      const insert = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO tenant_domains
           (tenant_id, hostname, domain_type, is_primary, verification_token_hash, verification_expires_at, created_by)
         VALUES ($1, $2, 'CUSTOM', false, $3, now() + interval '24 hours', $4)
         RETURNING id, created_at`,
        [tenantId, hostname, tokenHash, actor.adminId],
      );
      const domain = insert.rows[0];
      if (!domain) {
        throw new Error("Custom domain creation did not return a row.");
      }
      await appendAuditRecord(client, {
        actorType: "PLATFORM_ADMIN",
        actorId: actor.adminId,
        action: "tenant.domain_added",
        targetType: "TENANT_DOMAIN",
        targetId: domain.id,
        requestId,
        afterState: {
          tenantId,
          hostname,
          verified: false,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      });
      return {
        domain: {
          id: domain.id,
          hostname,
          type: "CUSTOM",
          verifiedAt: null,
          createdAt: domain.created_at.toISOString(),
        },
        verification: {
          recordName: `_eventos-verification.${hostname}`,
          recordType: "TXT",
          recordValue: `eventos-verification=${verificationToken}`,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError(
        "CONFLICT",
        "This hostname is already registered.",
        { cause: error },
      );
    }
    throw error;
  }
}

export async function verifyCustomDomain(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
  requestId: string,
) {
  const domainResult = await getControlPool().query<{
    hostname: string;
    verification_token_hash: string | null;
    verification_expires_at: Date | null;
    verified_at: Date | null;
  }>(
    `SELECT hostname, verification_token_hash, verification_expires_at, verified_at
     FROM tenant_domains WHERE id = $1 AND tenant_id = $2 AND domain_type = 'CUSTOM'`,
    [domainId, tenantId],
  );
  const domain = domainResult.rows[0];
  if (!domain) {
    throw new DomainError("NOT_FOUND", "The custom domain was not found.");
  }
  if (domain.verified_at) {
    return {
      verified: true,
      hostname: domain.hostname,
      verifiedAt: domain.verified_at.toISOString(),
    };
  }
  if (
    !domain.verification_token_hash ||
    !domain.verification_expires_at ||
    domain.verification_expires_at <= new Date()
  ) {
    throw new DomainError(
      "DOMAIN_UNVERIFIED",
      "The domain verification challenge expired; create a new challenge.",
    );
  }

  let records: string[][];
  try {
    records = await resolveTxt(`_eventos-verification.${domain.hostname}`);
  } catch {
    throw new DomainError(
      "DOMAIN_UNVERIFIED",
      "The required DNS TXT verification record was not found.",
    );
  }
  const verified = records.some(
    (record) =>
      record.join("").startsWith("eventos-verification=") &&
      createHash("sha256")
        .update(record.join("").slice("eventos-verification=".length))
        .digest("hex") === domain.verification_token_hash,
  );
  if (!verified) {
    throw new DomainError(
      "DOMAIN_UNVERIFIED",
      "The DNS TXT verification value does not match.",
    );
  }

  return withControlTransaction(async (client) => {
    const updated = await client.query<{ hostname: string; verified_at: Date }>(
      `UPDATE tenant_domains
       SET verified_at = now(), verification_token_hash = NULL, verification_expires_at = NULL
       WHERE id = $1 AND tenant_id = $2 AND verified_at IS NULL AND verification_expires_at > now()
       RETURNING hostname, verified_at`,
      [domainId, tenantId],
    );
    const verifiedDomain = updated.rows[0];
    if (!verifiedDomain) {
      throw new DomainError(
        "DOMAIN_UNVERIFIED",
        "The domain challenge expired or was already consumed.",
      );
    }
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "tenant.domain_verified",
      targetType: "TENANT_DOMAIN",
      targetId: domainId,
      requestId,
      beforeState: { hostname: verifiedDomain.hostname, verified: false },
      afterState: {
        hostname: verifiedDomain.hostname,
        verified: true,
        verifiedAt: verifiedDomain.verified_at.toISOString(),
      },
    });
    return {
      verified: true,
      hostname: verifiedDomain.hostname,
      verifiedAt: verifiedDomain.verified_at.toISOString(),
    };
  });
}

export async function updateTenantHealth(
  tenantId: string,
  state: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "FAILED",
  version?: string,
) {
  await getControlPool().query(
    `UPDATE tenant_database_registry
     SET last_health_state = $2, last_health_check_at = now(), migration_version = COALESCE($3, migration_version)
     WHERE tenant_id = $1`,
    [tenantId, state, version ?? null],
  );
}
