import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const pageHeaders = vi.hoisted(() => ({ value: new Headers() }));
const platformRateLimit = vi.hoisted(() => ({
  namespace: "",
  auth: undefined as
    | ReturnType<typeof import("better-auth").betterAuth>
    | undefined,
}));
vi.mock("@/infrastructure/auth/auth", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/infrastructure/auth/auth")>();
  const { betterAuth } = await import("better-auth");
  return {
    ...original,
    getAuth: () => {
      if (!platformRateLimit.namespace)
        throw new Error("Test rate-limit namespace required");
      return (platformRateLimit.auth ??= betterAuth({
        ...original.getAuth().options,
        rateLimit: {
          ...original.getAuth().options.rateLimit,
          customStorage: {
            async consume(key, rule) {
              const bucket = `${platformRateLimit.namespace}:${key}`;
              const client = await getControlPool().connect();
              try {
                await client.query("BEGIN");
                await client.query(
                  "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                  [bucket],
                );
                const row = (
                  await client.query(
                    'SELECT "count","lastRequest" FROM platform_auth_rate_limits WHERE "key"=$1 FOR UPDATE',
                    [bucket],
                  )
                ).rows[0];
                const now = Date.now();
                const fresh =
                  !row || now - Number(row.lastRequest) >= rule.window * 1000;
                const allowed = fresh || row.count < rule.max;
                if (allowed)
                  await client.query(
                    'INSERT INTO platform_auth_rate_limits(id,"key","count","lastRequest") VALUES($1,$2,$3,$4) ON CONFLICT("key") DO UPDATE SET "count"=EXCLUDED."count","lastRequest"=EXCLUDED."lastRequest"',
                    [
                      randomUUID(),
                      bucket,
                      fresh ? 1 : row.count + 1,
                      fresh ? now : Number(row.lastRequest),
                    ],
                  );
                await client.query("COMMIT");
                return {
                  allowed,
                  retryAfter: allowed
                    ? null
                    : Math.ceil(
                        (Number(row.lastRequest) + rule.window * 1000 - now) /
                          1000,
                      ),
                };
              } catch (error) {
                await client.query("ROLLBACK");
                throw error;
              } finally {
                client.release();
              }
            },
          },
        },
      }));
    },
  };
});
vi.mock("next/headers", () => ({ headers: async () => pageHeaders.value }));
import TenantLoginPage from "@/app/login/page";
import AuthContinuePage from "@/app/auth/continue/page";
import { resolveTenantContext } from "@/modules/tenants/resolver";
import { resolveTenantRequest } from "@/modules/tenant-identity/request-auth";
import { makeDomainPrimary } from "@/modules/platform/tenants/domains";
import { GET as settingsGet } from "@/app/api/tenant/identity/settings/route";
import { GET as profileGet } from "@/app/api/tenant/identity/profile/route";
import { POST as usernameSet } from "@/app/api/tenant/identity/username/route";
import { POST as tenantAuthPost } from "@/app/api/tenant-auth/[...all]/route";
import { POST as platformAuthPost } from "@/app/api/auth/[...all]/route";
import {
  issueTenantUserInvitation,
  issueInitialTenantOwnerInvitation,
} from "@/modules/tenant-identity/repository";
import {
  getServerConfig,
  resetServerConfigForTests,
} from "@/shared/config/env";
import { hashPlatformPassword } from "@/infrastructure/auth/password";
import { applySqlMigrations } from "@/infrastructure/db/migrations/runner";
import { applyTenantPrismaMigrations } from "@/infrastructure/db/tenant/prisma-migrations";
import {
  closeTenantPools,
  getTenantPool,
} from "@/infrastructure/db/tenant/pool";
import { getControlPool } from "@/infrastructure/db/control/pool";
import {
  clearTenantAuthCache,
  getTenantAuth,
  type TenantContext,
} from "@/modules/tenant-identity/auth";
import { handleIdentityV2Auth } from "@/modules/tenant-identity/identity-v2-auth-route";
import {
  defaultProfileFields,
  validateProfileValues,
} from "@/modules/tenant-identity/identity-v2-schema";
import {
  getIdentitySettings,
  identityThrottle,
  saveIdentitySettings,
  saveParticipantProfile,
  encryptSmsConfiguration,
  decryptSmsConfiguration,
} from "@/modules/tenant-identity/identity-v2-repository";
import { readTestSms } from "@/modules/sms/test-provider";
import {
  featureKeys,
  featureSetSchema,
  limitSetSchema,
} from "@/modules/platform/plans/schema";
if (existsSync(".env")) process.loadEnvFile(".env");
type Fixture = {
  tenantId: string;
  databaseName: string;
  ownerId: string;
  instructorA: string;
  instructorB: string;
};
const fixtures: Fixture[] = [];
const day = 86_400_000;
const start = new Date(Date.now() + 20 * day);
const end = new Date(Date.now() + 80 * day);
function databaseUrl(base: string, name: string) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}
async function makeFixture(): Promise<Fixture> {
  const tenantId = randomUUID(),
    databaseName = `eventos_t_${tenantId.replaceAll("-", "")}`;
  const fixture = {
    tenantId,
    databaseName,
    ownerId: randomUUID(),
    instructorA: randomUUID(),
    instructorB: randomUUID(),
  };
  fixtures.push(fixture);
  const provisioner = new Client({
    connectionString: process.env.TENANT_PROVISIONING_DATABASE_URL,
  });
  await provisioner.connect();
  try {
    await provisioner.query(
      `CREATE DATABASE "${databaseName}" OWNER eventos_tenant_owner`,
    );
    await provisioner.query(
      `GRANT CONNECT ON DATABASE "${databaseName}" TO eventos_tenant_runtime,eventos_tenant_migrator`,
    );
  } finally {
    await provisioner.end();
  }
  const migration = new Client({
    connectionString: databaseUrl(
      process.env.TENANT_MIGRATION_DATABASE_URL ?? "",
      databaseName,
    ),
  });
  await migration.connect();
  try {
    await migration.query("SET ROLE eventos_tenant_owner");
    await applySqlMigrations(
      migration,
      path.join(
        process.cwd(),
        "src",
        "infrastructure",
        "db",
        "tenant",
        "migrations",
      ),
      `tenant-${tenantId}`,
    );
    await migration.query(
      "GRANT USAGE ON SCHEMA public TO eventos_tenant_runtime",
    );
    await migration.query(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO eventos_tenant_runtime",
    );
    await migration.query(
      "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO eventos_tenant_runtime",
    );
    await migration.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO eventos_tenant_runtime",
    );
    await migration.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_tenant_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO eventos_tenant_runtime",
    );
    await migration.query(
      "INSERT INTO tenant_metadata (tenant_id,slug,schema_version) VALUES ($1,$2,'0001_tenant_foundation')",
      [tenantId, `core-${tenantId.slice(0, 8)}`],
    );
    await migration.query(
      "INSERT INTO tenant_schema_migrations(version) VALUES ('0001_tenant_foundation')",
    );
  } finally {
    await migration.end();
  }
  await applyTenantPrismaMigrations(databaseName, tenantId);
  const pool = getTenantPool(fixture);
  for (const [id, name] of [
    [fixture.ownerId, "Owner"],
    [fixture.instructorA, "Instructor A"],
    [fixture.instructorB, "Instructor B"],
  ]) {
    await pool.query(
      `INSERT INTO tenant_users (id,"tenantId",name,email,"emailVerified",status) VALUES ($1,$2,$3,$4,true,'ACTIVE')`,
      [id, tenantId, name, `${id}@example.test`],
    );
  }
  for (const id of [fixture.instructorA, fixture.instructorB])
    await pool.query(
      "INSERT INTO tenant_instructor_profiles (tenant_id,user_id,display_name) VALUES ($1,$2,$3)",
      [
        tenantId,
        id,
        id === fixture.instructorA ? "Instructor A" : "Instructor B",
      ],
    );
  return fixture;
}

function context(fixture: Fixture): TenantContext {
  return {
    tenantId: fixture.tenantId,
    databaseName: fixture.databaseName,
    slug: `identity-${fixture.tenantId.slice(0, 8)}`,
    hostname: `identity-${fixture.tenantId.slice(0, 8)}.localhost`,
    primaryHostname: `identity-${fixture.tenantId.slice(0, 8)}.localhost`,
    status: "ACTIVE",
    locale: "fa-IR",
    timezone: "Asia/Tehran",
    branding: {
      brandName: "Identity tests",
      primaryColor: "#145D58",
      accentColor: "#ffffff",
    },
    features: featureSetSchema.parse(
      Object.fromEntries(featureKeys.map((key) => [key, true])),
    ),
    limits: limitSetSchema.parse({
      max_staff: 100,
      max_participants: 100,
      max_active_runs: 100,
      max_storage_mb: 100,
      monthly_sms: 100,
      monthly_email: 100,
      max_branches: 10,
      max_custom_domains: 10,
    }),
  };
}
function request(
  tenant: TenantContext,
  path: string,
  body: unknown,
  cookie = "",
) {
  const origin = `http://${tenant.hostname}:3000`;
  return new Request(`${origin}/api/tenant-auth${path}`, {
    method: "POST",
    headers: {
      host: `${tenant.hostname}:3000`,
      origin,
      "content-type": "application/json",
      "x-forwarded-for": `192.0.2.${Number(String((body as { phoneNumber?: string }).phoneNumber ?? "1").slice(-2)) + 1}`,
      cookie,
    },
    body: JSON.stringify(body),
  });
}
async function authRequest(
  tenant: TenantContext,
  path: string,
  body: unknown,
  cookie = "",
) {
  return handleIdentityV2Auth(
    request(tenant, path, body, cookie),
    tenant,
    `http://${tenant.hostname}:3000`,
    path,
  );
}
describe("Identity V2 real PostgreSQL", () => {
  let a: TenantContext,
    b: TenantContext,
    userId = "",
    cookie = "";
  const phone = "+989121234567",
    password = "Identity-test-password-123!";
  beforeAll(async () => {
    vi.stubEnv("SMS_TRANSPORT", "test");
    const url = new URL(process.env.TENANT_PROVISIONING_DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname))
      throw new Error("Disposable local PostgreSQL is required.");
    a = context(await makeFixture());
    b = context(await makeFixture());
    for (const tenant of [a, b]) {
      await getControlPool().query(
        `INSERT INTO tenants (id,slug,legal_name,display_name,status,plan_id,created_by) SELECT $1,$2,'Identity fixture','Identity fixture','ACTIVE',id,'identity-v2-test' FROM plans LIMIT 1`,
        [tenant.tenantId, tenant.slug],
      );
      await getControlPool().query(
        "INSERT INTO tenant_sms_provider_allowlist (tenant_id,provider_key,allowed) VALUES ($1,'KAVENEGAR',$2)",
        [tenant.tenantId, tenant === a],
      );
      await getControlPool().query(
        "INSERT INTO tenant_database_registry(tenant_id,database_name,migration_version,last_health_state) VALUES($1,$2,'0015_owner_password_setup','HEALTHY')",
        [tenant.tenantId, tenant.databaseName],
      );
      await getControlPool().query(
        "INSERT INTO tenant_branding(tenant_id,brand_name,updated_by) VALUES($1,$2,'identity-v2-test')",
        [tenant.tenantId, tenant.branding.brandName],
      );
      await getControlPool().query(
        "INSERT INTO tenant_domains(tenant_id,hostname,domain_type,is_primary,verified_at,created_by) VALUES($1,$2,'PLATFORM_SUBDOMAIN',true,now(),'identity-v2-test')",
        [tenant.tenantId, tenant.hostname],
      );
      for (const [key, enabled] of Object.entries(tenant.features))
        await getControlPool().query(
          "INSERT INTO tenant_features(tenant_id,feature_key,enabled,updated_by) VALUES($1,$2,$3,'identity-v2-test')",
          [tenant.tenantId, key, enabled],
        );
      for (const [key, value] of Object.entries(tenant.limits))
        await getControlPool().query(
          "INSERT INTO tenant_limits(tenant_id,limit_key,limit_value,updated_by) VALUES($1,$2,$3,'identity-v2-test')",
          [tenant.tenantId, key, value],
        );
    }
  }, 120000);
  afterAll(async () => {
    clearTenantAuthCache();
    for (const fixture of fixtures) {
      await getControlPool().query(
        "DELETE FROM tenant_database_registry WHERE tenant_id=$1",
        [fixture.tenantId],
      );
      await getControlPool().query(
        "DELETE FROM tenant_sms_provider_allowlist WHERE tenant_id=$1",
        [fixture.tenantId],
      );
      await getControlPool().query("DELETE FROM tenants WHERE id=$1", [
        fixture.tenantId,
      ]);
    }
    await closeTenantPools();
    const client = new Client({
      connectionString: process.env.TENANT_PROVISIONING_DATABASE_URL,
    });
    await client.connect();
    try {
      for (const fixture of fixtures)
        await client.query(`DROP DATABASE IF EXISTS "${fixture.databaseName}"`);
    } finally {
      await client.end();
    }
    vi.unstubAllEnvs();
  }, 30000);
  it("issues and verifies phone registration through Better Auth", async () => {
    const cached = getTenantAuth(a, `http://${a.hostname}`);
    expect(getTenantAuth(a, `http://${a.hostname}`)).toBe(cached);
    expect(
      getTenantAuth(
        { ...a, features: { ...a.features, sms: false } },
        `http://${a.hostname}`,
      ),
    ).not.toBe(cached);
    expect(
      getTenantAuth(
        { ...a, limits: { ...a.limits, monthly_sms: 0 } },
        `http://${a.hostname}`,
      ),
    ).not.toBe(cached);
    expect(
      (
        await authRequest(a, "/phone-number/send-otp", {
          phoneNumber: "09121234567",
        })
      ).status,
    ).toBe(200);
    const code = readTestSms(a.tenantId, phone)?.code;
    expect(code).toMatch(/^\d{6}$/);
    const response = await authRequest(a, "/phone-number/verify", {
      phoneNumber: "9121234567",
      code,
      username: "identity_person",
      password,
      profile: { first_name: "نام", last_name: "آزمایشی" },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = (await response.json()) as { user: { id: string } };
    userId = payload.user.id;
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const user = await getTenantPool(a).query(
      'SELECT "phoneNumber","phoneNumberVerified",email,"emailVerified",username,name FROM tenant_users WHERE id=$1',
      [userId],
    );
    expect(user.rows[0]).toMatchObject({
      phoneNumber: phone,
      phoneNumberVerified: true,
      emailVerified: false,
      username: "identity_person",
      name: "نام آزمایشی",
    });
    expect(user.rows[0].email).toMatch(/@phone\.eventos\.invalid$/);
    const roles = await getTenantPool(a).query(
      "SELECT r.code FROM tenant_user_roles ur JOIN tenant_roles r ON r.id=ur.role_id AND r.tenant_id=ur.tenant_id WHERE ur.user_id=$1 AND ur.tenant_id=$2",
      [userId, a.tenantId],
    );
    expect(roles.rows.map((row) => row.code)).toContain("participant");
    expect(
      await getTenantAuth(a, `http://${a.hostname}:3000`).api.getSession({
        headers: new Headers({ cookie }),
      }),
    ).not.toBeNull();
  });
  it("logs in with normalized username without a verified internal email", async () => {
    const response = await authRequest(a, "/sign-in/username", {
      username: "IDENTITY_PERSON",
      password,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(((await response.json()) as { user: { id: string } }).user.id).toBe(
      userId,
    );
  });
  it("denies cross-tenant sessions at real settings and profile routes", async () => {
    const headers = { host: `${b.hostname}:3000`, cookie };
    expect(
      (
        await settingsGet(
          new Request(
            `http://${b.hostname}:3000/api/tenant/identity/settings`,
            { headers },
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await profileGet(
          new Request(`http://${b.hostname}:3000/api/tenant/identity/profile`, {
            headers,
          }),
        )
      ).status,
    ).toBe(401);
    const own = await settingsGet(
      new Request(`http://${a.hostname}:3000/api/tenant/identity/settings`, {
        headers: { host: `${a.hostname}:3000`, cookie },
      }),
    );
    expect(own.status).toBe(403);
  });
  it("does not reveal phone membership before OTP proof", async () => {
    const verify = (phoneNumber: string) =>
      tenantAuthPost(
        request(a, "/phone-number/verify", { phoneNumber, code: "000000" }),
      );
    const registered = await verify(phone);
    const unknown = await verify("+989121234559");
    expect(registered.status).toBe(400);
    expect(unknown.status).toBe(registered.status);
    expect(await unknown.json()).toEqual(await registered.json());
  });
  it("lets an existing verified email account assign one immutable username", async () => {
    const ownerId = fixtures[0]?.ownerId;
    if (!ownerId) throw new Error("Missing owner fixture");
    await getTenantPool(a).query(
      'INSERT INTO tenant_auth_accounts (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,\'credential\',$2,$3,now(),now())',
      [randomUUID(), ownerId, await hashPlatformPassword(password)],
    );
    const signedIn = await getTenantAuth(
      a,
      `http://${a.hostname}:3000`,
    ).api.signInEmail({
      body: { email: `${ownerId}@example.test`, password },
      asResponse: true,
    });
    expect(signedIn.status).toBe(200);
    const ownerCookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const assign = (username: string) =>
      usernameSet(
        new Request(`http://${a.hostname}:3000/api/tenant/identity/username`, {
          method: "POST",
          headers: {
            host: `${a.hostname}:3000`,
            origin: `http://${a.hostname}:3000`,
            cookie: ownerCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ username }),
        }),
      );
    expect((await assign("Owner_Identity")).status).toBe(200);
    expect((await assign("different_identity")).status).toBe(409);
    expect(
      (
        await getTenantPool(a).query(
          'SELECT username FROM tenant_users WHERE id=$1 AND "tenantId"=$2',
          [ownerId, a.tenantId],
        )
      ).rows[0]?.username,
    ).toBe("owner_identity");
  });
  it("rejects expired phone OTP through the trusted library", async () => {
    const expiredPhone = "+989121234561";
    expect(
      (
        await authRequest(a, "/phone-number/send-otp", {
          phoneNumber: expiredPhone,
        })
      ).status,
    ).toBe(200);
    const code = readTestSms(a.tenantId, expiredPhone)?.code;
    await getTenantPool(a).query(
      "UPDATE tenant_auth_verifications SET \"expiresAt\"=now()-interval '1 second'",
    );
    expect(
      (
        await authRequest(a, "/phone-number/verify", {
          phoneNumber: expiredPhone,
          code,
          username: "expired_person",
          profile: { first_name: "A", last_name: "B" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await getTenantPool(a).query(
          'SELECT 1 FROM tenant_users WHERE "phoneNumber"=$1',
          [expiredPhone],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("protects phone and username uniqueness while allowing the same identities in another tenant", async () => {
    await expect(
      getTenantPool(a).query(
        "INSERT INTO tenant_users (id,\"tenantId\",name,email,status,\"phoneNumber\") VALUES ($1,$2,'Duplicate',$3,'ACTIVE',$4)",
        [randomUUID(), a.tenantId, `${randomUUID()}@example.test`, phone],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      getTenantPool(a).query(
        "INSERT INTO tenant_users (id,\"tenantId\",name,email,status,username) VALUES ($1,$2,'Duplicate',$3,'ACTIVE','identity_person')",
        [randomUUID(), a.tenantId, `${randomUUID()}@example.test`],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await getTenantPool(b).query(
      "INSERT INTO tenant_users (id,\"tenantId\",name,email,status,\"phoneNumber\",username) VALUES ($1,$2,'Independent',$3,'ACTIVE',$4,'identity_person')",
      [randomUUID(), b.tenantId, `${randomUUID()}@example.test`, phone],
    );
    expect(readTestSms(b.tenantId, phone)).toBeUndefined();
    expect(
      (
        await authRequest(b, "/sign-in/username", {
          username: "identity_person",
          password,
        })
      ).status,
    ).toBe(401);
  });
  it("rejects consumed OTP replay and repeated guesses", async () => {
    const old = readTestSms(a.tenantId, phone)?.code;
    expect(
      (
        await authRequest(a, "/phone-number/verify", {
          phoneNumber: phone,
          code: old,
        })
      ).status,
    ).toBe(400);
    const guessPhone = "+989121234568";
    await authRequest(a, "/phone-number/send-otp", { phoneNumber: guessPhone });
    const wrongCode =
      readTestSms(a.tenantId, guessPhone)?.code === "000000"
        ? "111111"
        : "000000";
    for (let i = 0; i < 3; i++)
      expect(
        (
          await authRequest(a, "/phone-number/verify", {
            phoneNumber: guessPhone,
            code: wrongCode,
            username: "wrong_guesses",
            profile: { first_name: "A", last_name: "B" },
          })
        ).status,
      ).toBe(400);
    const correct = readTestSms(a.tenantId, guessPhone)?.code;
    expect(
      (
        await authRequest(a, "/phone-number/verify", {
          phoneNumber: guessPhone,
          code: correct,
          username: "wrong_guesses",
          profile: { first_name: "A", last_name: "B" },
        })
      ).status,
    ).toBe(403);
  });
  it("bounds concurrent OTP sends with a persisted cooldown", async () => {
    const sends = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        authRequest(a, "/phone-number/send-otp", {
          phoneNumber: "+989121234569",
        }),
      ),
    );
    expect(sends.filter((entry) => entry.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(sends.filter((entry) => entry.status === "rejected")).toHaveLength(
      4,
    );
  });
  it("validates current required fields and persists tenant-scoped values", async () => {
    const incompletePhone = "+989121234557";
    expect(
      (
        await authRequest(a, "/phone-number/send-otp", {
          phoneNumber: incompletePhone,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authRequest(a, "/phone-number/verify", {
          phoneNumber: incompletePhone,
          code: readTestSms(a.tenantId, incompletePhone)?.code,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await getTenantPool(a).query(
          'SELECT count(*)::int AS count FROM tenant_users WHERE "tenantId"=$1 AND "phoneNumber"=$2',
          [a.tenantId, incompletePhone],
        )
      ).rows[0]?.count,
    ).toBe(0);
    const settings = await getIdentitySettings(a);
    const fields = settings.fields.map((field) =>
      field.key === "occupation"
        ? { ...field, enabled: true, required: true }
        : field,
    );
    await getTenantPool(a).query(
      "INSERT INTO tenant_identity_settings (tenant_id,login_methods,profile_fields) VALUES ($1,$2,$3)",
      [a.tenantId, JSON.stringify(settings.methods), JSON.stringify(fields)],
    );
    await expect(
      saveParticipantProfile(
        a,
        userId,
        { first_name: "A", last_name: "B" },
        "profile",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await saveParticipantProfile(
      a,
      userId,
      { first_name: "نام", last_name: "آزمایشی", occupation: "مدرس" },
      "profile",
    );
    const profile = await getTenantPool(a).query(
      "SELECT profile_values FROM tenant_participant_profiles WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, userId],
    );
    expect(profile.rows[0].profile_values.occupation).toBe("مدرس");
    const readOnlyNames = fields.map((field) =>
      ["first_name", "last_name"].includes(field.key)
        ? { ...field, userEditable: false }
        : field,
    );
    await getTenantPool(a).query(
      "UPDATE tenant_identity_settings SET profile_fields=$2 WHERE tenant_id=$1",
      [a.tenantId, JSON.stringify(readOnlyNames)],
    );
    await getTenantPool(a).query(
      "UPDATE tenant_participant_profiles SET first_name='',last_name='',display_name='Legacy Name' WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, userId],
    );
    await getTenantPool(a).query(
      "UPDATE tenant_users SET name='Legacy Name' WHERE \"tenantId\"=$1 AND id=$2",
      [a.tenantId, userId],
    );
    await saveParticipantProfile(a, userId, { occupation: "مدرس" }, "profile");
    const preserved = await getTenantPool(a).query(
      "SELECT p.display_name,u.name FROM tenant_participant_profiles p JOIN tenant_users u ON u.id=p.user_id WHERE p.tenant_id=$1 AND p.user_id=$2",
      [a.tenantId, userId],
    );
    expect(preserved.rows[0]).toEqual({
      display_name: "Legacy Name",
      name: "Legacy Name",
    });
    await getTenantPool(a).query(
      "UPDATE tenant_identity_settings SET profile_fields=$2 WHERE tenant_id=$1",
      [a.tenantId, JSON.stringify(fields)],
    );
    await saveParticipantProfile(
      a,
      userId,
      { first_name: "نام", last_name: "آزمایشی", occupation: "مدرس" },
      "profile",
    );
    expect(
      (await getIdentitySettings(b)).fields.find(
        (field) => field.key === "occupation",
      )?.enabled,
    ).toBe(false);
    await expect(
      saveParticipantProfile(
        b,
        userId,
        { first_name: "A", last_name: "B" },
        "profile",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("requires OTP and an authenticated session to replace mobile", async () => {
    await expect(
      saveParticipantProfile(
        a,
        userId,
        {
          first_name: "A",
          last_name: "B",
          occupation: "Teacher",
          mobile: "09121234560",
        },
        "profile",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const newPhone = "+989121234560";
    await authRequest(a, "/phone-number/send-otp", { phoneNumber: newPhone });
    const code = readTestSms(a.tenantId, newPhone)?.code;
    await expect(
      authRequest(a, "/phone-number/verify", {
        phoneNumber: newPhone,
        code,
        updatePhoneNumber: true,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const response = await authRequest(
      a,
      "/phone-number/verify",
      { phoneNumber: newPhone, code, updatePhoneNumber: true },
      cookie,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      (
        await getTenantPool(a).query(
          'SELECT "phoneNumber" FROM tenant_users WHERE id=$1',
          [userId],
        )
      ).rows[0].phoneNumber,
    ).toBe(newPhone);
  });
  it("encrypts provider secrets with tenant-bound authentication and never returns them in settings", async () => {
    const encrypted = encryptSmsConfiguration(a.tenantId, "KAVENEGAR", {
      apiKey: "a".repeat(32),
      otpTemplate: "verify",
    });
    expect(encrypted.toString()).not.toContain("a".repeat(32));
    expect(
      decryptSmsConfiguration(a.tenantId, "KAVENEGAR", encrypted),
    ).toMatchObject({ otpTemplate: "verify" });
    expect(() =>
      decryptSmsConfiguration(b.tenantId, "KAVENEGAR", encrypted),
    ).toThrow();
    await getTenantPool(a).query(
      "UPDATE tenant_identity_settings SET sms_provider_key='KAVENEGAR',sms_config_ciphertext=$2 WHERE tenant_id=$1",
      [a.tenantId, encrypted],
    );
    expect(JSON.stringify(await getIdentitySettings(a))).not.toContain(
      "a".repeat(32),
    );
    const ownerId = fixtures[0]?.ownerId;
    if (!ownerId) throw new Error("Missing owner fixture");
    await getTenantPool(a).query(
      "INSERT INTO tenant_user_roles (tenant_id,user_id,role_id) SELECT $1,$2,id FROM tenant_roles WHERE tenant_id=$1 AND code='organization_owner' ON CONFLICT DO NOTHING",
      [a.tenantId, ownerId],
    );
    await getTenantPool(a).query(
      `INSERT INTO tenant_auth_accounts (id,"accountId","providerId","userId",password) VALUES ($1,$2,'credential',$2,$3) ON CONFLICT DO NOTHING`,
      [randomUUID(), ownerId, await hashPlatformPassword(password)],
    );
    const response = await getTenantAuth(
      a,
      `http://${a.hostname}:3000`,
    ).handler(
      request(a, "/sign-in/email", {
        email: `${ownerId}@example.test`,
        password,
      }),
    );
    expect(response.status).toBe(200);
    const ownerCookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const settingsResponse = await settingsGet(
      new Request(`http://${a.hostname}:3000/api/tenant/identity/settings`, {
        headers: { host: `${a.hostname}:3000`, cookie: ownerCookie },
      }),
    );
    expect(settingsResponse.status).toBe(200);
    const body = await settingsResponse.text();
    expect(body).not.toContain("a".repeat(32));
    expect(body).not.toContain("sms_config_ciphertext");
    expect(body).toContain('"otpTemplate":"verify"');
  });
  it("authenticates on a verified custom Host and isolates sessions through primary changes", async () => {
    const hostname = `event-${a.tenantId.slice(0, 8)}.tenant-test.example.test`;
    const result = await getControlPool().query<{ id: string }>(
      "INSERT INTO tenant_domains(tenant_id,hostname,domain_type,is_primary,verified_at,created_by) VALUES($1,$2,'CUSTOM',false,now(),'identity-v2-test') RETURNING id",
      [a.tenantId, hostname],
    );
    const custom = await resolveTenantContext(hostname);
    expect(custom.tenantId).toBe(a.tenantId);
    expect(custom.branding.brandName).toBe(a.branding.brandName);
    pageHeaders.value = new Headers({ host: `${hostname}:3000` });
    const page = await TenantLoginPage({ searchParams: Promise.resolve({}) });
    expect(page.props.brandName).toBe(a.branding.brandName);
    const resolved = await resolveTenantRequest(
      request(custom, "/phone-number/send-otp", {}),
    );
    expect(resolved.origin).toBe(`http://${hostname}:3000`);
    const customPhone = "+989121234590";
    expect(
      (
        await tenantAuthPost(
          request(custom, "/phone-number/send-otp", {
            phoneNumber: customPhone,
          }),
        )
      ).status,
    ).toBe(200);
    const code = readTestSms(a.tenantId, customPhone)?.code;
    expect(code).toMatch(/^\d{6}$/);
    expect(readTestSms(b.tenantId, customPhone)).toBeUndefined();
    const verified = await tenantAuthPost(
      request(custom, "/phone-number/verify", {
        phoneNumber: customPhone,
        code,
        username: "custom_host_person",
        password,
        profile: {
          first_name: "Custom",
          last_name: "Host",
          occupation: "Tester",
        },
      }),
    );
    expect(verified.status, await verified.clone().text()).toBe(200);
    const customCookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(
      verified.headers
        .getSetCookie()
        .every((value) => !/;\s*domain=/i.test(value)),
    ).toBe(true);
    const login = await tenantAuthPost(
      request(custom, "/sign-in/username", {
        username: "custom_host_person",
        password,
      }),
    );
    expect(login.status, await login.clone().text()).toBe(200);
    const profileRequest = (host: string) =>
      new Request(`http://${host}:3000/api/tenant/identity/profile`, {
        headers: { host: `${host}:3000`, cookie: customCookie },
      });
    expect((await profileGet(profileRequest(hostname))).status).toBe(200);
    pageHeaders.value = new Headers({
      host: `${hostname}:3000`,
      cookie: customCookie,
    });
    await expect(
      AuthContinuePage({
        searchParams: Promise.resolve({ next: "/events/custom-host-event" }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(";/events/custom-host-event;"),
    });
    expect((await profileGet(profileRequest(b.hostname))).status).toBe(401);
    const domainId = result.rows[0]?.id;
    if (!domainId) throw new Error("Missing custom domain fixture");
    await makeDomainPrimary(
      a.tenantId,
      domainId,
      {
        adminId: randomUUID(),
        userId: randomUUID(),
        email: "gate@example.test",
        name: "Gate",
        twoFactorEnabled: false,
      },
      randomUUID(),
    );
    expect((await resolveTenantContext(hostname)).primaryHostname).toBe(
      hostname,
    );
    expect((await resolveTenantContext(a.hostname)).primaryHostname).toBe(
      hostname,
    );
    expect((await profileGet(profileRequest(hostname))).status).toBe(200);
    expect((await profileGet(profileRequest(b.hostname))).status).toBe(401);
  });
  it("keeps phone, username and platform login working without mail and rejects email before writes", async () => {
    const previousMail = process.env.MAIL_TRANSPORT;
    const adminId = randomUUID();
    // Dedicated database-backed bucket: no shared developer records are reset,
    // and trusted-IP handling and production thresholds remain unchanged.
    platformRateLimit.namespace = `identity_rate_${randomUUID().replaceAll("-", "")}`;
    platformRateLimit.auth = undefined;
    vi.stubEnv("MAIL_TRANSPORT", "disabled");
    resetServerConfigForTests();
    try {
      const settings = await getIdentitySettings(a);
      expect(settings.mailAvailable).toBe(false);
      expect(settings.methods).toMatchObject({
        email_password: false,
        email_otp: false,
        username_password: true,
      });
      const newPhone = "+989121234592";
      expect(
        (
          await tenantAuthPost(
            request(a, "/phone-number/send-otp", { phoneNumber: newPhone }),
          )
        ).status,
      ).toBe(200);
      const code = readTestSms(a.tenantId, newPhone)?.code;
      expect(code).toMatch(/^\d{6}$/);
      const registration = await tenantAuthPost(
        request(a, "/phone-number/verify", {
          phoneNumber: newPhone,
          code,
          username: "mail_disabled_person",
          password,
          profile: {
            first_name: "SMS",
            last_name: "Only",
            ...(settings.fields.some(
              (field) =>
                field.key === "occupation" &&
                field.enabled &&
                field.showDuringSignup,
            )
              ? { occupation: "Tester" }
              : {}),
          },
        }),
      );
      expect(registration.status, await registration.clone().text()).toBe(200);
      const login = await tenantAuthPost(
        request(a, "/sign-in/username", {
          username: "mail_disabled_person",
          password,
        }),
      );
      expect(login.status, await login.clone().text()).toBe(200);
      const snapshot = async () =>
        (
          await getTenantPool(a).query(
            "SELECT (SELECT count(*)::int FROM tenant_users) AS users,(SELECT count(*)::int FROM tenant_invitations) AS invitations,(SELECT count(*)::int FROM tenant_auth_verifications) AS verifications",
          )
        ).rows[0];
      const before = await snapshot();
      for (const path of [
        "/email-otp/send-verification-otp",
        "/sign-in/email-otp",
        "/sign-in/email",
        "/sign-up/email",
        "/forget-password",
        "/reset-password",
      ]) {
        const response = await tenantAuthPost(
          request(a, path, { email: "unavailable@example.test" }),
        );
        expect(response.status).toBe(403);
        expect(await response.text()).toContain("سرویس ایمیل در دسترس نیست");
      }
      const actor = {
        id: fixtures[0]?.ownerId ?? "",
        tenantId: a.tenantId,
        email: "owner@example.test",
        name: "Owner",
        authenticationLevel: "PASSWORD",
        permissions: new Set(["participant.create"]),
      };
      await expect(
        issueTenantUserInvitation(
          a,
          {
            name: "No invitation",
            email: "unavailable@example.test",
            roleCodes: ["participant"],
            profileType: "PARTICIPANT",
          },
          actor,
          randomUUID(),
          `http://${a.hostname}:3000`,
        ),
      ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
      await expect(
        issueInitialTenantOwnerInvitation(
          a,
          { name: "No owner invite", email: "owner-unavailable@example.test" },
          randomUUID(),
          `http://${a.hostname}:3000`,
        ),
      ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
      await expect(
        saveIdentitySettings(
          a,
          userId,
          {
            methods: { ...settings.methods, email_otp: true },
            fields: settings.fields,
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
      await expect(
        saveIdentitySettings(
          a,
          userId,
          {
            methods: { ...settings.methods, email_password: true },
            fields: settings.fields,
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
      expect(await snapshot()).toEqual(before);
      await expect(
        saveIdentitySettings(
          a,
          userId,
          {
            methods: {
              sms_otp: false,
              username_password: false,
              email_password: false,
              email_otp: false,
              google: true,
            },
            fields: settings.fields,
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const platformOrigin = getServerConfig().BETTER_AUTH_URL;
      const platformRequest = (path: string, body: unknown) =>
        new Request(`${platformOrigin}/api/auth${path}`, {
          method: "POST",
          headers: {
            host: new URL(platformOrigin).host,
            origin: platformOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      expect(
        (
          await platformAuthPost(
            platformRequest("/request-password-reset", {
              email: "unavailable@example.test",
            }),
          )
        ).status,
      ).toBe(403);
      await getControlPool().query(
        'INSERT INTO platform_auth_users(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Mail disabled admin\',$2,true,now(),now())',
        [adminId, `${adminId}@example.test`],
      );
      await getControlPool().query(
        'INSERT INTO platform_auth_accounts(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',
        [randomUUID(), adminId, await hashPlatformPassword(password)],
      );
      await getControlPool().query(
        "INSERT INTO platform_admins(id,auth_user_id,email,display_name) VALUES($1::uuid,$1::text,$2,'Mail disabled admin')",
        [adminId, `${adminId}@example.test`],
      );
      const platformLogin = await platformAuthPost(
        platformRequest("/sign-in/email", {
          email: `${adminId}@example.test`,
          password,
        }),
      );
      expect(platformLogin.status, await platformLogin.clone().text()).toBe(
        200,
      );
      for (let attempt = 0; attempt < 5; attempt++) {
        const rejected = await platformAuthPost(
          platformRequest("/sign-in/email", {
            email: `${adminId}@example.test`,
            password: "Incorrect synthetic password",
          }),
        );
        expect(rejected.status).toBe(attempt === 4 ? 429 : 401);
      }
    } finally {
      await getControlPool().query(
        'DELETE FROM platform_auth_rate_limits WHERE starts_with("key",$1)',
        [platformRateLimit.namespace + ":"],
      );
      platformRateLimit.auth = undefined;
      platformRateLimit.namespace = "";
      for (const table of ["platform_auth_sessions", "platform_auth_accounts"])
        await getControlPool().query(`DELETE FROM ${table} WHERE "userId"=$1`, [
          adminId,
        ]);
      await getControlPool().query(
        "DELETE FROM platform_admins WHERE auth_user_id=$1",
        [adminId],
      );
      await getControlPool().query(
        "DELETE FROM platform_auth_users WHERE id=$1",
        [adminId],
      );
      vi.stubEnv("MAIL_TRANSPORT", previousMail);
      resetServerConfigForTests();
    }
  });
  it("rejects disabled SMS endpoints and unsafe lockout configuration", async () => {
    const settings = await getIdentitySettings(a);
    await expect(
      saveIdentitySettings(
        a,
        userId,
        {
          methods: {
            sms_otp: false,
            username_password: false,
            email_password: true,
            email_otp: false,
            google: false,
          },
          fields: settings.fields,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await getTenantPool(a).query(
      "UPDATE tenant_identity_settings SET login_methods=jsonb_set(login_methods,'{sms_otp}','false') WHERE tenant_id=$1",
      [a.tenantId],
    );
    await expect(
      authRequest(a, "/phone-number/send-otp", { phoneNumber: phone }),
    ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });
  it("enforces persistent verification rate limits under concurrency", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        identityThrottle(a, "guess-concurrency", 60, 3),
      ),
    );
    expect(
      attempts.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(3);
    expect(
      attempts.filter((entry) => entry.status === "rejected"),
    ).toHaveLength(9);
  });
});
