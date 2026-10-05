import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, type Browser, type Page } from "@playwright/test";

function smsCode(phone: string): string {
  const file = process.env.EVENTOS_E2E_SMS_HTTP_OUTBOX;
  if (!file) throw new Error("Missing SMS HTTP test capture");
  const messages = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { phone: string; code: string });
  const message = messages.findLast((entry) => entry.phone === phone);
  if (!message) throw new Error("SMS provider delivery was not captured");
  return message.code;
}
export async function runIdentityV2BrowserFlows(input: {
  browser: Browser;
  ownerPage: Page;
  tenantId: string;
  tenantOrigin: string;
  sourceRunId: string;
}) {
  const { ownerPage, tenantOrigin, tenantId } = input;
  const platformOrigin = process.env.BETTER_AUTH_URL ?? "";
  await ownerPage.goto(`${platformOrigin}/platform/tenants/${tenantId}`);
  const capabilities = await ownerPage.request.patch(
    `${platformOrigin}/api/platform/tenants/${tenantId}/features`,
    {
      headers: { origin: platformOrigin },
      data: { overrides: [{ key: "sms", enabled: true }] },
    },
  );
  expect(capabilities.status()).toBe(200);
  const smsLimit = await ownerPage.request.patch(
    `${platformOrigin}/api/platform/tenants/${tenantId}/limits`,
    {
      headers: { origin: platformOrigin },
      data: { overrides: [{ key: "monthly_sms", value: 100 }] },
    },
  );
  expect(smsLimit.status()).toBe(200);
  const allowed = await ownerPage.request.patch(
    `${platformOrigin}/api/platform/tenants/${tenantId}/sms-providers`,
    {
      headers: { origin: platformOrigin },
      data: { providerKey: "KAVENEGAR", allowed: true },
    },
  );
  expect(allowed.status()).toBe(200);
  await ownerPage.goto(`${tenantOrigin}/settings`);
  await expect(ownerPage.getByLabel("API Key", { exact: true })).toBeVisible();
  await ownerPage
    .getByLabel("API Key", { exact: true })
    .fill(randomBytes(24).toString("hex"));
  await ownerPage.getByLabel("Template", { exact: true }).fill("verify");
  const configured = ownerPage.waitForResponse(
    (response) =>
      response.url().endsWith("/api/tenant/identity/settings") &&
      response.request().method() === "POST",
  );
  await ownerPage
    .getByRole("button", { name: "ذخیره پیامک", exact: true })
    .click();
  expect((await configured).status()).toBe(200);
  await expect(
    ownerPage.getByText("وضعیت: پیکربندی شده", { exact: true }),
  ).toBeVisible();
  await expect(ownerPage.getByLabel("API Key", { exact: true })).toHaveValue(
    "",
  );
  const settingsResponse = await ownerPage.request.get(
    `${tenantOrigin}/api/tenant/identity/settings`,
  );
  const original = (await settingsResponse.json()).data as {
    methods: Record<string, boolean>;
    fields: Array<Record<string, unknown>>;
  };
  const control = new Client({
    connectionString: process.env.CONTROL_DATABASE_URL,
  });
  await control.connect();
  let db: Client | undefined;
  const participant = await input.browser.newContext();
  const page = await participant.newPage();
  try {
    const registry = await control.query<{ database_name: string }>(
      "SELECT database_name FROM tenant_database_registry WHERE tenant_id=$1",
      [tenantId],
    );
    const url = new URL(process.env.TENANT_RUNTIME_DATABASE_URL ?? "");
    url.pathname = `/${registry.rows[0]?.database_name}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    const event = await db.query<{ id: string }>(
      `INSERT INTO program_runs (tenant_id,program_id,title,starts_at,ends_at,registration_starts_at,registration_ends_at,delivery_mode,capacity,minimum_capacity,waitlist_enabled,state,venue_id,notes,created_by,registration_form_schema,price_amount,price_currency)
      SELECT tenant_id,program_id,'ثبت‌نام پیامکی',starts_at,ends_at,registration_starts_at,registration_ends_at,'ONLINE',10,NULL,false,'PUBLISHED',NULL,notes,created_by,'{"version":1,"fields":[]}'::jsonb,0,'IRR' FROM program_runs WHERE tenant_id=$1 AND id=$2 RETURNING id`,
      [tenantId, input.sourceRunId],
    );
    const eventPath = `/events/${event.rows[0]?.id}`;
    await ownerPage.getByLabel("ورود با پیامک", { exact: true }).check();
    await ownerPage
      .getByLabel("نام کاربری و رمز عبور", { exact: true })
      .check();
    // D: configure a required profile field through the actual tenant builder.
    const occupation = ownerPage
      .locator("details")
      .filter({ has: ownerPage.locator("summary", { hasText: /^شغل\s*$/ }) });
    await occupation.locator("summary").click();
    await occupation.getByLabel("فعال", { exact: true }).check();
    await occupation.getByLabel("ضروری", { exact: true }).check();
    const saved = ownerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tenant/identity/settings") &&
        response.request().method() === "PUT",
    );
    await ownerPage
      .getByRole("button", { name: "ذخیره روش‌های ورود و فرم" })
      .click();
    expect((await saved).status()).toBe(200);
    const effective = (
      await (
        await ownerPage.request.get(
          `${tenantOrigin}/api/tenant/identity/settings`,
        )
      ).json()
    ).data;
    expect(effective.methods.sms_otp).toBe(true);
    expect(
      effective.providers.find(
        (provider: { key: string }) => provider.key === "KAVENEGAR",
      )?.allowed,
    ).toBe(true);
    // A and C: register from an event, verify the normal generated OTP, and return.
    await page.goto(`${tenantOrigin}${eventPath}`);
    await page
      .getByRole("button", { name: "ثبت‌نام در دوره", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    // Existing tenant resolver entries expire after 15 seconds across route bundles.
    // Poll the actual public capability; never sleep or bypass its server guard.
    await expect
      .poll(
        async () => {
          await page.reload();
          return page
            .getByRole("button", { name: "ورود با پیامک", exact: true })
            .count();
        },
        { timeout: 20_000 },
      )
      .toBe(1);
    await page.getByRole("link", { name: "ثبت‌نام", exact: true }).click();
    await expect(page.locator("#profile-occupation")).toHaveAttribute(
      "required",
      "",
    );
    for (const width of [320, 375, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
    const phone =
      "0912" + String(Math.floor(1000000 + Math.random() * 8999999));
    const username = `pilot_${randomUUID().slice(0, 8)}`;
    const password = "Identity-browser-password-123!";
    await page.locator("#identity-mobile").fill(phone);
    await page.locator("#profile-first_name").fill("شرکت‌کننده");
    await page.locator("#profile-last_name").fill("پیامکی");
    await page.locator("#profile-occupation").fill("مدرس");
    await page.locator("#identity-username").fill(username);
    await page.locator("#identity-password").fill(password);
    const sent = page.waitForResponse((response) =>
      response.url().endsWith("/phone-number/send-otp"),
    );
    await page.getByRole("button", { name: "ارسال کد", exact: true }).click();
    expect((await sent).status()).toBe(200);
    await page.locator("#identity-code").fill(smsCode(phone));
    await page
      .getByRole("button", { name: "تأیید و ادامه", exact: true })
      .click();
    await expect(page).toHaveURL(`${tenantOrigin}${eventPath}`);
    await page
      .getByRole("button", { name: "ثبت‌نام در دوره", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("ثبت‌نام شما تأیید شد");
    await page.goto(`${tenantOrigin}/account`);
    await expect(
      page.getByRole("heading", { name: "پروفایل من", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#profile-occupation")).toHaveValue("مدرس");
    expect(await page.locator("body").innerText()).not.toContain(
      "@phone.eventos.invalid",
    );
    // E: replacement phone remains unchanged until an OTP is verified.
    const newPhone = "0913" + phone.slice(4);
    await page.locator("#profile-new-mobile").fill(newPhone);
    const changeSent = page.waitForResponse((response) =>
      response.url().endsWith("/phone-number/send-otp"),
    );
    await page
      .getByRole("button", { name: "ارسال کد تأیید شماره جدید" })
      .click();
    expect((await changeSent).status()).toBe(200);
    await expect(
      page.getByText("موبایل تأییدشده:", { exact: false }),
    ).toContainText(`+98${phone.slice(1)}`);
    await page.locator("#profile-mobile-code").fill(smsCode(newPhone));
    await page
      .getByRole("button", { name: "تأیید شماره جدید", exact: true })
      .click();
    await expect(
      page.getByText("موبایل تأییدشده:", { exact: false }),
    ).toContainText(`+98${newPhone.slice(1)}`);
    // B: password authentication uses the official username plugin.
    await page.getByRole("button", { name: "خروج امن", exact: true }).click();
    await expect(page).toHaveURL(`${tenantOrigin}/login`);
    await page
      .getByRole("button", { name: "نام کاربری و رمز عبور", exact: true })
      .click();
    await page.locator("#login-username").fill(username.toUpperCase());
    await page.locator("#login-password").fill(password);
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page).toHaveURL(`${tenantOrigin}/account`);
    // F: disabling SMS hides the method and rejects direct requests.
    await ownerPage.goto(`${tenantOrigin}/settings`);
    await ownerPage.getByLabel("ورود با پیامک", { exact: true }).uncheck();
    const disabled = ownerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tenant/identity/settings") &&
        response.request().method() === "PUT",
    );
    await ownerPage
      .getByRole("button", { name: "ذخیره روش‌های ورود و فرم" })
      .click();
    expect((await disabled).status()).toBe(200);
    await page.getByRole("button", { name: "خروج امن", exact: true }).click();
    await expect(page).toHaveURL(`${tenantOrigin}/login`);
    await expect(
      page.getByRole("button", { name: "ورود با پیامک", exact: true }),
    ).toHaveCount(0);
    const rejected = await page.request.post(
      `${tenantOrigin}/api/tenant-auth/phone-number/send-otp`,
      { headers: { origin: tenantOrigin }, data: { phoneNumber: phone } },
    );
    expect(rejected.status()).toBe(403);
  } finally {
    const restored = await ownerPage.request.put(
      `${tenantOrigin}/api/tenant/identity/settings`,
      {
        headers: { origin: tenantOrigin },
        data: { methods: original.methods, fields: original.fields },
      },
    );
    expect(restored.status()).toBe(200);
    await participant.close();
    await db?.end();
    await control.end();
  }
}
