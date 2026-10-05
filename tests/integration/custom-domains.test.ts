import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getControlPool,
  closeControlPool,
} from "@/infrastructure/db/control/pool";
import {
  createTenant,
  createCustomDomain,
  verifyCustomDomain,
} from "@/modules/platform/tenants/service";
import {
  issueDomainVerification,
  makeDomainPrimary,
  removeTenantDomain,
} from "@/modules/platform/tenants/domains";
import {
  clearTenantResolutionCacheForTests,
  resolveTenantContext,
  tenantResolutionCacheSize,
} from "@/modules/tenants/resolver";
import { resetServerConfigForTests } from "@/shared/config/env";
import { featureKeys, limitKeys } from "@/modules/platform/plans/schema";
import {
  resolveTenantRequest,
  resolveTenantFromHeaders,
  assertTenantSameOrigin,
} from "@/modules/tenant-identity/request-auth";
import { DELETE as removeRoute } from "@/app/api/platform/tenants/[tenantId]/domains/[domainId]/route";
import { POST as primaryRoute } from "@/app/api/platform/tenants/[tenantId]/domains/[domainId]/primary/route";
import { POST as rotateRoute } from "@/app/api/platform/tenants/[tenantId]/domains/[domainId]/verification/route";

if (existsSync(".env")) process.loadEnvFile(".env");
const actor = {
  adminId: randomUUID(),
  userId: randomUUID(),
  email: "domain-admin@example.invalid",
  name: "Domain test admin",
  twoFactorEnabled: false,
};
const planId = randomUUID();
const tenants: string[] = [];
const challenges: string[] = [];
const originalOrigin = process.env.BETTER_AUTH_URL;
const originalBase = process.env.PLATFORM_BASE_DOMAIN;
const requestId = () => randomUUID();
const uniqueHost = () => `event-${randomUUID().slice(0, 8)}.customer.example`;
const pool = () => getControlPool();
async function fixture() {
  const id = randomUUID();
  tenants.push(id);
  const slug = `domain-${id.slice(0, 8)}`;
  await pool().query(
    "INSERT INTO tenants(id,slug,legal_name,display_name,status,plan_id,created_by) VALUES($1,$2,'Domain fixture','Domain fixture','ACTIVE',$3,$4)",
    [id, slug, planId, actor.adminId],
  );
  // Control-only resolver fixture: no operational tenant DB or provisioning job is required.
  await pool().query(
    "INSERT INTO tenant_database_registry(tenant_id,database_name,migration_version,last_health_state) VALUES($1,$2,'0014_identity_v2','HEALTHY')",
    [id, `eventos_t_${id.replaceAll("-", "")}`],
  );
  await pool().query(
    "INSERT INTO tenant_branding(tenant_id,brand_name,updated_by) VALUES($1,$2,$3)",
    [id, slug, actor.adminId],
  );
  const primary = await pool().query<{ id: string }>(
    "INSERT INTO tenant_domains(tenant_id,hostname,domain_type,is_primary,verified_at,created_by) VALUES($1,$2,'PLATFORM_SUBDOMAIN',true,now(),$3) RETURNING id",
    [id, `${slug}.localhost`, actor.adminId],
  );
  const primaryId = primary.rows[0]?.id;
  if (!primaryId) throw new Error("Fixture primary missing");
  return { id, hostname: `${slug}.localhost`, primaryId };
}
async function add(id: string, hostname = uniqueHost()) {
  const result = await createCustomDomain(
    id,
    { hostname, isPrimary: false },
    actor,
    requestId(),
  );
  challenges.push(result.verification.recordValue);
  return result;
}
async function verify(id: string, domain: Awaited<ReturnType<typeof add>>) {
  return verifyCustomDomain(
    id,
    domain.domain.id,
    actor,
    requestId(),
    async (name) => {
      expect(name).toBe(domain.verification.recordName);
      return [[domain.verification.recordValue]];
    },
  );
}
beforeAll(async () => {
  // Model a distinct platform host and preserve the existing local subdomain namespace.
  process.env.BETTER_AUTH_URL = "https://event.mediasanat.ir";
  process.env.PLATFORM_BASE_DOMAIN = "localhost";
  resetServerConfigForTests();
  await pool().query(
    "INSERT INTO plans(id,code,name,features,limits) VALUES($1,$2,'Domain test plan',$3,$4)",
    [
      planId,
      `domain_${planId.slice(0, 8)}`,
      JSON.stringify(Object.fromEntries(featureKeys.map((key) => [key, true]))),
      JSON.stringify(Object.fromEntries(limitKeys.map((key) => [key, 100]))),
    ],
  );
});
beforeEach(() => clearTenantResolutionCacheForTests());
afterAll(async () => {
  for (const id of tenants) {
    await pool().query(
      "DELETE FROM tenant_database_registry WHERE tenant_id=$1",
      [id],
    );
    await pool().query("DELETE FROM tenants WHERE id=$1", [id]);
  }
  await pool().query("DELETE FROM plans WHERE id=$1", [planId]);
  await closeControlPool();
  process.env.BETTER_AUTH_URL = originalOrigin;
  process.env.PLATFORM_BASE_DOMAIN = originalBase;
  resetServerConfigForTests();
  clearTenantResolutionCacheForTests();
});

describe("custom domain core with real PostgreSQL and injected DNS", () => {
  it("reserves the platform hostname during tenant creation without introducing DNS provisioning dependencies", async () => {
    process.env.PLATFORM_BASE_DOMAIN = "mediasanat.ir";
    resetServerConfigForTests();
    try {
      await expect(
        createTenant(
          {
            slug: "event",
            displayName: "Reserved tenant",
            planCode: "foundation",
            ownerName: "Test Owner",
            ownerEmail: "owner@example.invalid",
          },
          actor,
          requestId(),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    } finally {
      process.env.PLATFORM_BASE_DOMAIN = "localhost";
      resetServerConfigForTests();
    }
  });
  it("stores canonical ASCII, hashed expiring proof and rejects global duplicates and platform hostname", async () => {
    const a = await fixture(),
      b = await fixture();
    const domain = await add(
      a.id,
      `BÜCHER-${randomUUID().slice(0, 8)}.Example.`,
    );
    expect(domain.domain.hostname).toMatch(/^xn--/);
    const stored = await pool().query(
      "SELECT verification_token_hash,verification_expires_at FROM tenant_domains WHERE id=$1",
      [domain.domain.id],
    );
    expect(stored.rows[0].verification_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.rows[0].verification_token_hash).not.toContain(
      domain.verification.recordValue,
    );
    expect(stored.rows[0].verification_expires_at.getTime()).toBeGreaterThan(
      Date.now(),
    );
    await expect(add(b.id, domain.domain.hostname)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(add(a.id, "event.mediasanat.ir")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      resolveTenantContext("event.mediasanat.ir"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      pool().query(
        "INSERT INTO tenant_domains(tenant_id,hostname,domain_type,verified_at,created_by) VALUES($1,$2,'CUSTOM',now(),$3)",
        [b.id, domain.domain.hostname, actor.adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("rejects wrong and expired proof, rotates it and verifies split TXT without public DNS", async () => {
    const a = await fixture();
    const domain = await add(a.id);
    await expect(
      verifyCustomDomain(
        a.id,
        domain.domain.id,
        actor,
        requestId(),
        async () => [["wrong"]],
      ),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    await pool().query(
      "UPDATE tenant_domains SET verification_expires_at=now()-interval '1 second' WHERE id=$1",
      [domain.domain.id],
    );
    const dns = vi.fn();
    await expect(
      verifyCustomDomain(a.id, domain.domain.id, actor, requestId(), dns),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    expect(dns).not.toHaveBeenCalled();
    const rotated = await issueDomainVerification(
      a.id,
      domain.domain.id,
      actor,
      requestId(),
    );
    challenges.push(rotated.recordValue);
    expect(rotated.recordValue).not.toBe(domain.verification.recordValue);
    await expect(verify(a.id, domain)).rejects.toMatchObject({
      code: "DOMAIN_UNVERIFIED",
    });
    const done = await verifyCustomDomain(
      a.id,
      domain.domain.id,
      actor,
      requestId(),
      async () => [
        [rotated.recordValue.slice(0, 25), rotated.recordValue.slice(25)],
      ],
    );
    expect(done.verified).toBe(true);
    await expect(
      issueDomainVerification(a.id, domain.domain.id, actor, requestId()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects a stale DNS success when a challenge rotates during lookup", async () => {
    const a = await fixture();
    const domain = await add(a.id);
    await expect(
      verifyCustomDomain(
        a.id,
        domain.domain.id,
        actor,
        requestId(),
        async () => {
          await issueDomainVerification(
            a.id,
            domain.domain.id,
            actor,
            requestId(),
          );
          return [[domain.verification.recordValue]];
        },
      ),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    const result = await pool().query(
      "SELECT verified_at FROM tenant_domains WHERE id=$1",
      [domain.domain.id],
    );
    expect(result.rows[0].verified_at).toBeNull();
  });
  it("rechecks expiry at commit and never verifies a removed domain", async () => {
    const a = await fixture();
    const domain = await add(a.id);
    await expect(
      verifyCustomDomain(
        a.id,
        domain.domain.id,
        actor,
        requestId(),
        async () => {
          await pool().query(
            "UPDATE tenant_domains SET verification_expires_at=now()-interval '1 second' WHERE id=$1",
            [domain.domain.id],
          );
          return [[domain.verification.recordValue]];
        },
      ),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    const rotated = await issueDomainVerification(
      a.id,
      domain.domain.id,
      actor,
      requestId(),
    );
    await expect(
      verifyCustomDomain(
        a.id,
        domain.domain.id,
        actor,
        requestId(),
        async () => {
          await removeTenantDomain(a.id, domain.domain.id, actor, requestId());
          return [[rotated.recordValue]];
        },
      ),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
  });
  it("resolves exact verified ownership and rejects unverified/unknown/cross-tenant hostnames", async () => {
    const a = await fixture(),
      b = await fixture();
    const da = await add(a.id),
      db = await add(b.id);
    await expect(
      resolveTenantContext(da.domain.hostname),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    await verify(a.id, da);
    await verify(b.id, db);
    const [ca, cb] = await Promise.all([
      resolveTenantContext(da.domain.hostname),
      resolveTenantContext(db.domain.hostname),
    ]);
    expect(ca.tenantId).toBe(a.id);
    expect(cb.tenantId).toBe(b.id);
    expect(ca.databaseName).not.toBe(cb.databaseName);
    expect(ca.branding.brandName).not.toBe(cb.branding.brandName);
    await expect(
      resolveTenantContext(`attacker.${da.domain.hostname}`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      verifyCustomDomain(
        b.id,
        da.domain.id,
        actor,
        requestId(),
        async () => [],
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const context = await resolveTenantRequest(
      new Request(`http://${da.domain.hostname}/login`, {
        headers: {
          host: da.domain.hostname,
          origin: `http://${da.domain.hostname}`,
          "x-forwarded-host": db.domain.hostname,
        },
      }),
    );
    expect(context.tenant.tenantId).toBe(a.id);
    expect(context.origin).toBe(`http://${da.domain.hostname}`);
    const originalMode = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const production = await resolveTenantFromHeaders(
        new Headers({
          host: da.domain.hostname,
          "x-forwarded-host": db.domain.hostname,
          "x-forwarded-proto": "http",
        }),
      );
      expect(production.origin).toBe(`https://${da.domain.hostname}`);
      expect(production.tenant.tenantId).toBe(a.id);
    } finally {
      vi.stubEnv("NODE_ENV", originalMode);
    }
    expect(() =>
      assertTenantSameOrigin(
        new Request(`http://${da.domain.hostname}`, {
          headers: { origin: `http://${db.domain.hostname}` },
        }),
        context.origin,
      ),
    ).toThrow();
  });
  it("requires verification/ownership, switches transactionally, preserves previous domain and invalidates cache", async () => {
    const a = await fixture(),
      b = await fixture();
    const domain = await add(a.id);
    await expect(
      makeDomainPrimary(a.id, domain.domain.id, actor, requestId()),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    await verify(a.id, domain);
    await resolveTenantContext(a.hostname);
    await resolveTenantContext(domain.domain.hostname);
    expect(tenantResolutionCacheSize()).toBe(2);
    await expect(
      makeDomainPrimary(b.id, domain.domain.id, actor, requestId()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await makeDomainPrimary(a.id, domain.domain.id, actor, requestId());
    expect(tenantResolutionCacheSize()).toBe(0);
    expect((await resolveTenantContext(a.hostname)).primaryHostname).toBe(
      domain.domain.hostname,
    );
    const rows = await pool().query(
      "SELECT id,is_primary FROM tenant_domains WHERE tenant_id=$1",
      [a.id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.filter((row) => row.is_primary)).toHaveLength(1);
    await expect(
      pool().query("UPDATE tenant_domains SET is_primary=true WHERE id=$1", [
        a.primaryId,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("serializes concurrent primary switches and custom-domain quotas", async () => {
    const a = await fixture();
    const one = await add(a.id),
      two = await add(a.id);
    await verify(a.id, one);
    await verify(a.id, two);
    await Promise.all([
      makeDomainPrimary(a.id, one.domain.id, actor, requestId()),
      makeDomainPrimary(a.id, two.domain.id, actor, requestId()),
    ]);
    const rows = await pool().query(
      "SELECT id FROM tenant_domains WHERE tenant_id=$1 AND is_primary",
      [a.id],
    );
    expect(rows.rows).toHaveLength(1);
    await pool().query(
      "INSERT INTO tenant_limits(tenant_id,limit_key,limit_value,updated_by) VALUES($1,'max_custom_domains',3,$2)",
      [a.id, actor.adminId],
    );
    const additions = await Promise.allSettled([add(a.id), add(a.id)]);
    expect(additions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(additions.filter((r) => r.status === "rejected")).toHaveLength(1);
    const denied = additions.find((r) => r.status === "rejected");
    if (denied?.status === "rejected")
      expect(denied.reason).toMatchObject({ code: "LIMIT_REACHED" });
  });
  it("prevents primary deletion/orphaning and invalidates a deleted non-primary domain", async () => {
    const a = await fixture(),
      b = await fixture();
    await expect(
      removeTenantDomain(a.id, a.primaryId, actor, requestId()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const domain = await add(a.id);
    await verify(a.id, domain);
    await resolveTenantContext(domain.domain.hostname);
    await expect(
      removeTenantDomain(b.id, domain.domain.id, actor, requestId()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await removeTenantDomain(a.id, domain.domain.id, actor, requestId());
    expect(tenantResolutionCacheSize()).toBe(0);
    await expect(
      resolveTenantContext(domain.domain.hostname),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await resolveTenantContext(a.hostname)).tenantId).toBe(a.id);
  });
  it("rechecks cached mappings after domain mutations by another process", async () => {
    const a = await fixture();
    const domain = await add(a.id);
    await verify(a.id, domain);
    await resolveTenantContext(domain.domain.hostname);
    // Direct SQL intentionally simulates a committed write outside this process/cache.
    await pool().query(
      "UPDATE tenant_domains SET is_primary=false WHERE tenant_id=$1",
      [a.id],
    );
    await pool().query(
      "UPDATE tenant_domains SET is_primary=true WHERE id=$1",
      [domain.domain.id],
    );
    expect(
      (await resolveTenantContext(domain.domain.hostname)).primaryHostname,
    ).toBe(domain.domain.hostname);
    await pool().query(
      "UPDATE tenant_domains SET is_primary=false WHERE tenant_id=$1",
      [a.id],
    );
    await pool().query(
      "UPDATE tenant_domains SET is_primary=true WHERE id=$1",
      [a.primaryId],
    );
    await pool().query("DELETE FROM tenant_domains WHERE id=$1", [
      domain.domain.id,
    ]);
    await expect(
      resolveTenantContext(domain.domain.hostname),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("protects new mutation routes with real platform authorization and same-origin checks", async () => {
    const a = await fixture();
    const domain = await add(a.id);
    const context = {
      params: Promise.resolve({ tenantId: a.id, domainId: domain.domain.id }),
    };
    for (const [method, handler] of [
      ["DELETE", removeRoute],
      ["POST", primaryRoute],
      ["POST", rotateRoute],
    ] as const) {
      const response = await handler(
        new Request(
          "https://event.mediasanat.ir/api/platform/tenants/domains",
          {
            method,
            headers: {
              host: "event.mediasanat.ir",
              origin: "https://event.mediasanat.ir",
            },
          },
        ),
        context,
      );
      expect(response.status).toBe(401);
      const cross = await handler(
        new Request(
          "https://event.mediasanat.ir/api/platform/tenants/domains",
          {
            method,
            headers: {
              host: "event.mediasanat.ir",
              origin: "https://attacker.example",
            },
          },
        ),
        context,
      );
      expect(cross.status).toBe(403);
    }
    expect(
      (
        await pool().query("SELECT id FROM tenant_domains WHERE id=$1", [
          domain.domain.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("audits every domain transition without plaintext verification values", async () => {
    const a = await fixture();
    const domain = await add(a.id);
    const rotated = await issueDomainVerification(
      a.id,
      domain.domain.id,
      actor,
      requestId(),
    );
    challenges.push(rotated.recordValue);
    await verifyCustomDomain(
      a.id,
      domain.domain.id,
      actor,
      requestId(),
      async () => [[rotated.recordValue]],
    );
    await makeDomainPrimary(a.id, domain.domain.id, actor, requestId());
    await makeDomainPrimary(a.id, a.primaryId, actor, requestId());
    await removeTenantDomain(a.id, domain.domain.id, actor, requestId());
    const audit = await pool().query(
      "SELECT action,before_state,after_state FROM platform_audit_logs WHERE target_id=$1",
      [domain.domain.id],
    );
    expect(new Set(audit.rows.map((row) => row.action))).toEqual(
      new Set([
        "domain.added",
        "domain.verification_issued",
        "domain.verified",
        "domain.primary_changed",
        "domain.removed",
      ]),
    );
    for (const value of challenges)
      expect(JSON.stringify(audit.rows)).not.toContain(value.split("=")[1]);
  });
});
