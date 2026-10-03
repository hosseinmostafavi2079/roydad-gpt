import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { reportCleanupFailures } from "../helpers/cleanup-failures";

type Input = {
  browser: Browser;
  tenantId: string;
  tenantOrigin: string;
  sourceRunId: string;
  participantEmail: string;
  mailOutboxPath: string;
};

function signedGoogleIdentity(input: {
  tenantId: string;
  email: string;
  verified: boolean;
  sub: string;
}) {
  const payload = Buffer.from(
    JSON.stringify({
      tenantId: input.tenantId,
      email: input.email,
      emailVerified: input.verified,
      sub: input.sub,
      name: "Pilot Google Participant",
      exp: Date.now() + 60_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update(`e2e-google:${input.tenantId}:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function mockGoogleIdentity(page: Page, token: string | (() => string)) {
  await page.route("**/api/tenant-auth/sign-in/social", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.continue({
      postData: JSON.stringify({
        ...body,
        idToken: { token: typeof token === "function" ? token() : token },
      }),
    });
  });
}

async function waitForAuthRateLimit(db: Client) {
  await expect
    .poll(
      async () => {
        const result = await db.query<{ last_request: string | null }>(
          'SELECT max("lastRequest")::text AS last_request FROM tenant_auth_rate_limits',
        );
        return Date.now() - Number(result.rows[0]?.last_request ?? 0);
      },
      { timeout: 65_000, intervals: [250, 500, 1_000] },
    )
    .toBeGreaterThanOrEqual(60_000);
}

async function clickGoogleWithRateLimit(page: Page, db: Client) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/tenant-auth/sign-in/social"),
    );
    await page.getByRole("button", { name: "ادامه با گوگل" }).click();
    const response = await responsePromise;
    if (response.status() !== 429) return response;
    await waitForAuthRateLimit(db);
  }
  throw new Error("Google sign-in remained rate limited after server reset.");
}

export async function runPilotAuthBrowserFlows(input: Input): Promise<void> {
  const control = new Client({
    connectionString: process.env.CONTROL_DATABASE_URL,
  });
  await control.connect();
  const registry = await control.query<{ database_name: string }>(
    "SELECT database_name FROM tenant_database_registry WHERE tenant_id=$1",
    [input.tenantId],
  );
  await control.end();
  const databaseName = registry.rows[0]?.database_name;
  if (!databaseName || !/^eventos_t_[0-9a-f]{32}$/.test(databaseName))
    throw new Error("Pilot E2E tenant database is unavailable.");
  const url = new URL(process.env.TENANT_RUNTIME_DATABASE_URL ?? "");
  url.pathname = `/${databaseName}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const contexts: Array<{ close(): Promise<void> }> = [];
  let originalError: unknown;
  try {
    const cloneRun = async (label: string) => {
      const title = `${label} ${randomUUID().slice(0, 8)}`;
      const result = await db.query<{ id: string }>(
        `INSERT INTO program_runs
          (tenant_id,program_id,title,starts_at,ends_at,registration_starts_at,
           registration_ends_at,delivery_mode,capacity,minimum_capacity,
           waitlist_enabled,state,venue_id,notes,created_by,
           registration_form_schema,price_amount,price_currency)
         SELECT tenant_id,program_id,$3,starts_at,ends_at,registration_starts_at,
           registration_ends_at,'ONLINE',10,NULL,false,'PUBLISHED',NULL,notes,
           created_by,'{"version":1,"fields":[]}'::jsonb,0,'IRR'
         FROM program_runs WHERE tenant_id=$1 AND id=$2 RETURNING id`,
        [input.tenantId, input.sourceRunId, title],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error("Pilot E2E run creation failed.");
      return { id, title, path: `/events/${id}` };
    };
    const passwordRun = await cloneRun("ورود با رمز");
    const otpRun = await cloneRun("ورود با کد");
    const googleRun = await cloneRun("ورود با گوگل");

    const passwordContext = await input.browser.newContext();
    contexts.push(passwordContext);
    const passwordPage = await passwordContext.newPage();
    for (const width of [320, 375, 390, 430, 768]) {
      await passwordPage.setViewportSize({ width, height: 800 });
      await passwordPage.goto(`${input.tenantOrigin}${passwordRun.path}`);
      expect(
        await passwordPage.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await passwordPage.goto(
        `${input.tenantOrigin}/login?participant=1&next=${encodeURIComponent(passwordRun.path)}`,
      );
      expect(
        await passwordPage.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await passwordPage.goto(
        `${input.tenantOrigin}/register?next=${encodeURIComponent(passwordRun.path)}`,
      );
      expect(
        await passwordPage.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
    await passwordPage.goto(`${input.tenantOrigin}${passwordRun.path}`);
    await passwordPage.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await passwordPage.waitForURL(
      `**/login?participant=1&next=${encodeURIComponent(passwordRun.path)}`,
    );
    await passwordPage
      .getByLabel("ایمیل", { exact: true })
      .fill(input.participantEmail);
    await passwordPage
      .getByLabel("گذرواژه", { exact: true })
      .fill("portal e2e password long");
    for (let attempt = 0; attempt < 2; attempt++) {
      const responsePromise = passwordPage.waitForResponse((response) =>
        response.url().includes("/api/tenant-auth/sign-in/email"),
      );
      await passwordPage.getByRole("button", { name: "ورود امن" }).click();
      const response = await responsePromise;
      if (response.status() !== 429) {
        expect(response.status()).toBe(200);
        break;
      }
      await waitForAuthRateLimit(db);
    }
    await passwordPage.waitForURL(`**${passwordRun.path}`);
    await passwordPage.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await expect(passwordPage.getByRole("status")).toContainText(
      "ثبت‌نام شما تأیید شد",
    );
    await passwordPage.goto(`${input.tenantOrigin}/account`);
    await expect(
      passwordPage.getByText(passwordRun.title).first(),
    ).toBeVisible();

    const otpContext = await input.browser.newContext();
    contexts.push(otpContext);
    const otpPage = await otpContext.newPage();
    await otpPage.goto(`${input.tenantOrigin}${otpRun.path}`);
    await otpPage.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await otpPage.waitForURL(
      `**/login?participant=1&next=${encodeURIComponent(otpRun.path)}`,
    );
    await otpPage.getByRole("button", { name: "ورود با کد یکبارمصرف" }).click();
    await otpPage
      .getByLabel("ایمیل", { exact: true })
      .fill(input.participantEmail);
    await otpPage.getByRole("button", { name: "دریافت کد" }).click();
    await expect(
      otpPage.getByText(/کد شش رقمی تا پنج دقیقه معتبر است/),
    ).toBeVisible();
    const messages = readFileSync(input.mailOutboxPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { email: string; text: string });
    const otp = messages
      .filter((entry) => entry.email === input.participantEmail)
      .at(-1)
      ?.text.match(/\b\d{6}\b/)?.[0];
    if (!otp) throw new Error("Pilot E2E OTP was not delivered.");
    await otpPage.getByLabel("کد یک‌بارمصرف ایمیلی").fill(otp);
    await otpPage.getByRole("button", { name: "ورود امن" }).click();
    await otpPage.waitForURL(`**${otpRun.path}`);
    await otpPage.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await expect(otpPage.getByRole("status")).toContainText(
      "ثبت‌نام شما تأیید شد",
    );

    const googleContext = await input.browser.newContext();
    contexts.push(googleContext);
    const googlePage = await googleContext.newPage();
    await googlePage.goto(
      `${input.tenantOrigin}/login?participant=1&next=${encodeURIComponent(googleRun.path)}`,
    );
    let initiation:
      | {
          status: number;
          body: { url?: string };
          headers: Record<string, string>;
        }
      | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      initiation = await googlePage.evaluate(
        async (callbackURL) => {
          const response = await fetch("/api/tenant-auth/sign-in/social", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: "google", callbackURL }),
          });
          return {
            status: response.status,
            body: (await response.json()) as { url?: string },
            headers: Object.fromEntries(response.headers.entries()),
          };
        },
        `/auth/continue?next=${encodeURIComponent(googleRun.path)}`,
      );
      if (initiation.status !== 429) break;
      await waitForAuthRateLimit(db);
    }
    if (!initiation) throw new Error("Google OAuth initiation did not run.");
    expect(initiation.status).toBe(200);
    const authorize = new URL(initiation.body.url ?? "");
    expect(authorize.hostname).toBe("accounts.google.com");
    expect(authorize.searchParams.get("state")).toBeTruthy();
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${input.tenantOrigin}/api/tenant-auth/callback/google`,
    );

    const existing = await db.query<{ id: string }>(
      'SELECT id FROM tenant_users WHERE "tenantId"=$1 AND email=$2',
      [input.tenantId, input.participantEmail],
    );
    const existingId = existing.rows[0]?.id;
    if (!existingId)
      throw new Error("Pilot E2E existing participant is missing.");
    const unverifiedSubject = `unverified-${randomUUID()}`;
    const unverified = () =>
      signedGoogleIdentity({
        tenantId: input.tenantId,
        email: input.participantEmail,
        verified: false,
        sub: unverifiedSubject,
      });
    await mockGoogleIdentity(googlePage, unverified);
    await clickGoogleWithRateLimit(googlePage, db);
    await expect(
      googlePage.locator(".tenant-auth-card [role=alert]"),
    ).toContainText("ورود با گوگل انجام نشد");
    await googlePage.unroute("**/api/tenant-auth/sign-in/social");
    const verifiedSubject = `verified-${randomUUID()}`;
    const verified = () =>
      signedGoogleIdentity({
        tenantId: input.tenantId,
        email: input.participantEmail,
        verified: true,
        sub: verifiedSubject,
      });
    await mockGoogleIdentity(googlePage, verified);
    await clickGoogleWithRateLimit(googlePage, db);
    await googlePage.waitForURL(`**${googleRun.path}`);
    const linked = await db.query<{ id: string; account_id: string | null }>(
      `SELECT u.id,a."accountId" AS account_id FROM tenant_users u
       LEFT JOIN tenant_auth_accounts a ON a."userId"=u.id AND a."providerId"='google'
       WHERE u."tenantId"=$1 AND u.email=$2`,
      [input.tenantId, input.participantEmail],
    );
    expect(linked.rowCount).toBe(1);
    expect(linked.rows[0]?.id).toBe(existingId);
    expect(linked.rows[0]?.account_id).toBeTruthy();
    await googlePage.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await expect(googlePage.getByRole("status")).toContainText(
      "ثبت‌نام شما تأیید شد",
    );

    const maliciousContext = await input.browser.newContext();
    contexts.push(maliciousContext);
    const maliciousPage = await maliciousContext.newPage();
    await maliciousPage.goto(
      `${input.tenantOrigin}/login?participant=1&next=${encodeURIComponent("//evil.example")}`,
    );
    await expect(
      maliciousPage.locator('a[href="/login?mode=register"]'),
    ).toBeVisible();
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    const results = await Promise.allSettled([
      ...contexts.map((context) => context.close()),
      db.end(),
    ]);
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    reportCleanupFailures(
      "Pilot browser cleanup failed",
      failures,
      originalError,
    );
  }
}

export async function runPilotGoogleNewUserFlow(input: Input): Promise<void> {
  const control = new Client({
    connectionString: process.env.CONTROL_DATABASE_URL,
  });
  await control.connect();
  let databaseName: string | undefined;
  try {
    const registry = await control.query<{ database_name: string }>(
      "SELECT database_name FROM tenant_database_registry WHERE tenant_id=$1",
      [input.tenantId],
    );
    databaseName = registry.rows[0]?.database_name;
  } finally {
    await control.end();
  }
  if (!databaseName || !/^eventos_t_[0-9a-f]{32}$/.test(databaseName))
    throw new Error("Pilot E2E tenant database is unavailable.");
  const url = new URL(process.env.TENANT_RUNTIME_DATABASE_URL ?? "");
  url.pathname = `/${databaseName}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const context = await input.browser.newContext();
  let originalError: unknown;
  try {
    const run = await db.query<{ id: string }>(
      `INSERT INTO program_runs
        (tenant_id,program_id,title,starts_at,ends_at,registration_starts_at,
         registration_ends_at,delivery_mode,capacity,minimum_capacity,
         waitlist_enabled,state,venue_id,notes,created_by,
         registration_form_schema,price_amount,price_currency)
       SELECT tenant_id,program_id,$3,starts_at,ends_at,registration_starts_at,
         registration_ends_at,'ONLINE',10,NULL,false,'PUBLISHED',NULL,notes,
         created_by,'{"version":1,"fields":[]}'::jsonb,0,'IRR'
       FROM program_runs WHERE tenant_id=$1 AND id=$2 RETURNING id`,
      [
        input.tenantId,
        input.sourceRunId,
        `ثبت‌نام با گوگل ${randomUUID().slice(0, 8)}`,
      ],
    );
    const runId = run.rows[0]?.id;
    if (!runId) throw new Error("Pilot E2E run creation failed.");
    const eventPath = `/events/${runId}`;
    const page = await context.newPage();
    const email = `google-${randomUUID()}@example.test`;
    const googleSubject = `new-${randomUUID()}`;
    await page.goto(
      `${input.tenantOrigin}/register?next=${encodeURIComponent(eventPath)}`,
    );
    await expect(page).toHaveURL(/\/login\?mode=register/);
    await mockGoogleIdentity(page, () =>
      signedGoogleIdentity({
        tenantId: input.tenantId,
        email,
        verified: true,
        sub: googleSubject,
      }),
    );
    const social = await clickGoogleWithRateLimit(page, db);
    const socialStatus = social.status();
    let callbackStatus: number | null = null;
    page.on("response", (response) => {
      if (response.url().includes("/api/tenant-auth/callback/google"))
        callbackStatus = response.status();
    });
    try {
      expect(socialStatus).toBe(200);
      await page.waitForURL(`**${eventPath}`);
    } catch (error) {
      const identity = await db.query<{
        user_exists: boolean;
        participant_exists: boolean;
        session_exists: boolean;
      }>(
        `SELECT EXISTS(SELECT 1 FROM tenant_users WHERE "tenantId"=$1 AND email=$2) AS user_exists,
                EXISTS(SELECT 1 FROM tenant_participant_profiles p JOIN tenant_users u
                  ON u.id=p.user_id AND u."tenantId"=p.tenant_id
                  WHERE p.tenant_id=$1 AND u.email=$2) AS participant_exists,
                EXISTS(SELECT 1 FROM tenant_auth_sessions s JOIN tenant_users u
                  ON u.id=s."userId" AND u."tenantId"=s."tenantId"
                  WHERE s."tenantId"=$1 AND u.email=$2) AS session_exists`,
        [input.tenantId, email],
      );
      throw new Error(
        `New Google participant did not reach event: ${JSON.stringify({ currentUrl: page.url(), socialStatus, callbackStatus, ...identity.rows[0] })}`,
        { cause: error },
      );
    }
    await page.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await expect(page.getByRole("status")).toContainText("ثبت‌نام شما تأیید شد");
    const participant = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tenant_participant_profiles p
       JOIN tenant_users u ON u."tenantId"=p.tenant_id AND u.id=p.user_id
       WHERE p.tenant_id=$1 AND u.email=$2`,
      [input.tenantId, email],
    );
    expect(participant.rows[0]?.count).toBe(1);
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    const results = await Promise.allSettled([context.close(), db.end()]);
    reportCleanupFailures(
      "New Google participant cleanup failed",
      results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason),
      originalError,
    );
  }
}
