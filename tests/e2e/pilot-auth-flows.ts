import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";

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

async function mockGoogleIdentity(page: Page, token: string) {
  await page.route("**/api/tenant-auth/sign-in/social", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    await route.continue({
      postData: JSON.stringify({ ...body, idToken: { token } }),
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
    const googleNewRun = await cloneRun("ثبت‌نام با گوگل");

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
      initiation = await googlePage.evaluate(async (callbackURL) => {
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
      }, googleRun.path);
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
    const unverified = signedGoogleIdentity({
      tenantId: input.tenantId,
      email: input.participantEmail,
      verified: false,
      sub: `unverified-${randomUUID()}`,
    });
    await mockGoogleIdentity(googlePage, unverified);
    await clickGoogleWithRateLimit(googlePage, db);
    await expect(googlePage.locator(".login-card [role=alert]")).toContainText(
      "ورود با گوگل انجام نشد",
    );
    await googlePage.unroute("**/api/tenant-auth/sign-in/social");
    const verified = signedGoogleIdentity({
      tenantId: input.tenantId,
      email: input.participantEmail,
      verified: true,
      sub: `verified-${randomUUID()}`,
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

    const newGoogleContext = await input.browser.newContext();
    contexts.push(newGoogleContext);
    const newGooglePage = await newGoogleContext.newPage();
    const newGoogleEmail = `google-${randomUUID()}@example.test`;
    await newGooglePage.goto(
      `${input.tenantOrigin}/register?next=${encodeURIComponent(googleNewRun.path)}`,
    );
    await mockGoogleIdentity(
      newGooglePage,
      signedGoogleIdentity({
        tenantId: input.tenantId,
        email: newGoogleEmail,
        verified: true,
        sub: `new-${randomUUID()}`,
      }),
    );
    await clickGoogleWithRateLimit(newGooglePage, db);
    await newGooglePage.waitForURL(`**${googleNewRun.path}`);
    await newGooglePage.getByRole("button", { name: "ثبت‌نام در دوره" }).click();
    await expect(newGooglePage.getByRole("status")).toContainText(
      "ثبت‌نام شما تأیید شد",
    );
    const newGoogleUser = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tenant_participant_profiles p
       JOIN tenant_users u ON u."tenantId"=p.tenant_id AND u.id=p.user_id
       WHERE p.tenant_id=$1 AND u.email=$2`,
      [input.tenantId, newGoogleEmail],
    );
    expect(newGoogleUser.rows[0]?.count).toBe(1);

    const maliciousContext = await input.browser.newContext();
    contexts.push(maliciousContext);
    const maliciousPage = await maliciousContext.newPage();
    await maliciousPage.goto(
      `${input.tenantOrigin}/login?participant=1&next=${encodeURIComponent("//evil.example")}`,
    );
    await expect(
      maliciousPage.locator('a[href="/register?next=%2Faccount"]'),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    await db.end();
  }
}
