import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Client } from "pg";
import { currentTotp } from "../helpers/totp";
import { workerDiagnostics } from "../helpers/worker-diagnostics";
import { reportCleanupFailures } from "../helpers/cleanup-failures";
import {
  gregorianWallToJalali,
  persianMonths,
  tenantWallTimeToUtc,
} from "@/modules/program-core/dates";
import { runPhase6BrowserFlows } from "./payment-flows";
import {
  runPilotAuthBrowserFlows,
  runPilotGoogleNewUserFlow,
} from "./pilot-auth-flows";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=",
  "base64",
);
const e2ePort = Number(process.env.EVENTOS_E2E_PORT ?? "3000");
async function setJalali(
  page: import("@playwright/test").Page,
  index: number,
  wall: string,
) {
  const value = gregorianWallToJalali(wall);
  const picker = page.locator(".jalali-picker").nth(index);
  await picker.getByLabel("سال خورشیدی").selectOption(String(value.year));
  await picker.getByLabel("ماه خورشیدی").selectOption(String(value.month));
  await picker.getByLabel("روز خورشیدی").selectOption(String(value.day));
  await picker.getByLabel("ساعت").fill(value.time);
}

async function navigateCalendarToDate(
  page: Page,
  sessionStart: string,
  tenantTimezone: string,
): Promise<void> {
  const heading = page.locator(".card .page-heading h2.card-title");
  await expect(heading).toBeVisible();
  const renderedMonth = (await heading.innerText()).trim();
  const match = /^(.+)\s+([۰-۹0-9٬,]+)$/.exec(renderedMonth);
  const currentMonth =
    persianMonths.indexOf(
      (match?.[1] ?? "") as (typeof persianMonths)[number],
    ) + 1;
  const currentYear = Number(
    match?.[2]
      ?.replace(/[٬,]/g, "")
      .replace(/[۰-۹]/g, (digit) =>
        String(digit.charCodeAt(0) - "۰".charCodeAt(0)),
      ),
  );
  if (
    !match ||
    !currentMonth ||
    !Number.isInteger(currentYear) ||
    currentYear <= 0
  )
    throw new Error(
      `Calendar month heading could not be read: ${renderedMonth}`,
    );

  const targetParts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: tenantTimezone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date(sessionStart));
  const part = (type: string) =>
    Number(targetParts.find((entry) => entry.type === type)?.value);
  const targetYear = part("year");
  const targetMonth = part("month");
  const distance =
    (targetYear - currentYear) * 12 + (targetMonth - currentMonth);
  console.info("E2E calendar fixture", {
    startsAt: sessionStart,
    tenantTimezone,
    currentJalaliYear: currentYear,
    currentJalaliMonth: currentMonth,
    sessionJalaliYear: targetYear,
    sessionJalaliMonth: targetMonth,
  });
  if (!Number.isInteger(distance) || Math.abs(distance) > 12)
    throw new Error(
      `Calendar target is outside the bounded test range: ${distance} months`,
    );
  const targetHeading = `${persianMonths[targetMonth - 1]} ${targetYear.toLocaleString("fa-IR")}`;
  for (let step = 0; step < Math.abs(distance); step++) {
    const before = await heading.innerText();
    await page
      .getByRole("button", { name: distance > 0 ? "ماه بعد" : "ماه قبل" })
      .click();
    await expect(heading).not.toHaveText(before);
  }
  await expect(heading).toHaveText(targetHeading);
}

type E2eState = {
  adminEmail: string;
  tenantId: string | null;
  tenantSlug: string | null;
  tenants?: Array<{ tenantId: string | null; tenantSlug: string }>;
  mailOutboxPath?: string;
};

function saveTenantState(
  tenantId: string | null,
  tenantSlug: string | null,
): void {
  const statePath = path.join(process.cwd(), "tests", ".e2e-state.json");
  if (!existsSync(statePath)) return;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as E2eState;
  const tenants = state.tenants ?? [];
  if (tenantSlug) {
    const existing = tenants.find((tenant) => tenant.tenantSlug === tenantSlug);
    if (existing) existing.tenantId = tenantId ?? existing.tenantId;
    else tenants.push({ tenantId, tenantSlug });
  }
  writeFileSync(
    statePath,
    JSON.stringify({
      ...state,
      tenantId: tenantId ?? state.tenantId,
      tenantSlug: tenantSlug ?? state.tenantSlug,
      tenants,
    }),
    { mode: 0o600 },
  );
}

function startWorker(fail = false): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import=tsx",
      "scripts/provisioning-worker.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
        ...(fail ? { EVENTOS_TEST_FAIL_PHASE: "MIGRATING" } : {}),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    },
  );
  child.stdin?.end();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const diagnostics = () => workerDiagnostics(stdout, stderr);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(child);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(
        new Error(`Provisioning worker readiness timed out; ${diagnostics()}`),
      );
    }, 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "eventos.provisioning.ready"
      ) {
        finish();
      }
    });
    child.once("close", (code, signal) =>
      finish(
        new Error(
          `Provisioning worker exited before readiness (code ${code}, signal ${signal}); ${diagnostics()}`,
        ),
      ),
    );
    child.once("error", (error) =>
      finish(
        new Error(
          `Provisioning worker spawn failed: ${error.message}; ${diagnostics()}`,
        ),
      ),
    );
  });
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Provisioning worker did not stop.")),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function* tenantJourney({
  page,
  request,
  browser,
}: {
  page: Page;
  request: APIRequestContext;
  browser: Browser;
}): AsyncGenerator<string, void, unknown> {
  const email = process.env.EVENTOS_E2E_ADMIN_EMAIL;
  const password = process.env.EVENTOS_E2E_ADMIN_PASSWORD;
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();
  if (!email || !password)
    throw new Error(
      "Playwright did not receive the temporary E2E admin credentials.",
    );
  const failWorker = await startWorker(true);
  let retryWorker: ChildProcess | undefined;
  let tenantId: string | null = null;
  let originalError: unknown;
  try {
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByLabel("ایمیل سازمانی").fill(email);
    await page.getByLabel("گذرواژه", { exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود امن به پلتفرم" }).click();
    if (process.env.PLATFORM_REQUIRE_MFA === "true") {
      await page.waitForURL("**/platform/security/mfa", { timeout: 15_000 });

      const enableResponse = page.waitForResponse((response) =>
        response.url().includes("/api/auth/two-factor/enable"),
      );
      await page.getByLabel("گذرواژهٔ فعلی").fill(password);
      await page
        .getByRole("button", { name: "راه‌اندازی احراز هویت دو‌مرحله‌ای" })
        .click();
      const setup = (await (await enableResponse).json()) as {
        totpURI: string;
        backupCodes: string[];
        method: string;
      };
      expect(setup.method).toBe("totp");
      expect(setup.backupCodes.length).toBeGreaterThan(0);
      const secret = new URL(setup.totpURI).searchParams.get("secret");
      expect(secret).toBeTruthy();
      if (!secret) throw new Error("Better Auth returned no TOTP secret.");
      const enrollmentCode = currentTotp(secret);
      await page.getByLabel("کد شش‌رقمی برنامه").fill(enrollmentCode);
      await page
        .getByRole("button", { name: "فعال‌سازی و ورود به پنل" })
        .click();
      await page.waitForURL("**/platform");
      await expect(
        page.getByRole("heading", { name: "به پنل EventOS خوش آمدید" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "خروج امن" }).click();
      await page.waitForURL("**/sign-in");
      await page.getByLabel("ایمیل سازمانی").fill(email);
      await page.getByLabel("گذرواژه", { exact: true }).fill(password);
      await page.getByRole("button", { name: "ورود امن به پلتفرم" }).click();
      await expect(page.getByLabel("کد برنامهٔ احراز هویت")).toBeVisible();
      await expect
        .poll(() => currentTotp(secret), { timeout: 35_000 })
        .not.toBe(enrollmentCode);
      await page.getByLabel("کد برنامهٔ احراز هویت").fill(currentTotp(secret));
      await page.getByRole("button", { name: "تأیید و ورود" }).click();
      await page.waitForURL("**/platform");
      await expect(
        page.getByRole("heading", { name: "به پنل EventOS خوش آمدید" }),
      ).toBeVisible();
    } else {
      await page.waitForURL("**/platform");
      await expect(page).not.toHaveURL(/\/platform\/security\/mfa/);
      await expect(page.getByLabel("کد برنامهٔ احراز هویت")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "به پنل EventOS خوش آمدید" }),
      ).toBeVisible();
    }
    await page.goto("/platform/plans");
    await expect(page.locator("textarea")).toHaveCount(0);
    await page.getByRole("button", { name: "ویرایش طرح" }).first().click();
    await expect(
      page.getByRole("checkbox", { name: "دوره‌ها" }).first(),
    ).toBeVisible();
    await expect(
      page.locator('input[name="limit:max_staff"]').first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "باز کردن منو" }).click();
    await expect(
      page.getByRole("dialog", { name: "منوی برنامه" }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "سازمان‌ها" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "منوی برنامه" })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    const denied = await request.get("/api/platform/tenants");
    expect(denied.status()).toBe(401);
    const csrfDenied = await request.post("/api/platform/tenants", {
      data: {
        slug: "denied-e2e",
        legalName: "Denied",
        displayName: "Denied",
        planCode: "foundation",
      },
      headers: { origin: "https://attacker.example" },
    });
    expect(csrfDenied.status()).toBe(403);

    const missingTenant = await page.goto(`/platform/tenants/${randomUUID()}`);
    expect(missingTenant?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "سازمان پیدا نشد" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "بازگشت به سازمان‌ها" }),
    ).toBeVisible();

    await page.goto("/platform/tenants/new");
    for (const width of [320, 375, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 850 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    const slug = `e2e-${randomUUID().slice(0, 8)}`;
    const ownerName = "E2E Tenant Owner";
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    saveTenantState(null, slug);
    await page.getByLabel("نام مجموعه").fill("EventOS E2E Organization");
    await page
      .getByLabel("نام ثبتی (اختیاری)")
      .fill("EventOS E2E Organization Inc.");
    await page.getByLabel("شناسه / زیردامنه").fill(slug);
    await page.getByLabel("نام مدیر اصلی").fill(ownerName);
    await page.getByLabel("ایمیل مدیر اصلی").fill(ownerEmail);
    await expect(page.getByText("این آدرس آزاد است ✓")).toBeVisible();
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByRole("button", { name: "ایجاد مجموعه" }).click();
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
    const provisioningStatus = page
      .getByRole("region", { name: "وضعیت راه‌اندازی" })
      .locator(".badge");
    tenantId = page.url().split("/").at(-1) ?? null;
    if (!tenantId)
      throw new Error("Created tenant URL did not contain a tenant ID.");
    saveTenantState(tenantId, slug);

    await expect(provisioningStatus).toHaveText("خطا در اعمال تغییرات", {
      timeout: 45_000,
    });
    await stopWorker(failWorker);
    retryWorker = await startWorker(false);
    await page.getByRole("button", { name: "تلاش دوباره" }).click();
    await expect(provisioningStatus).toHaveText("آماده استفاده", {
      timeout: 45_000,
    });
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const response = await fetch(`/api/platform/tenants/${id}`);
            if (!response.ok) return `HTTP_${response.status}`;
            const details = (await response.json()) as {
              data: { database: { state: string } };
            };
            return details.data.database.state;
          }, tenantId),
        { timeout: 20_000 },
      )
      .toBe("HEALTHY");
    await page.reload();
    await expect(page.locator("#tenant-health")).toContainText("سالم");
    await expect(
      page.getByRole("heading", { name: "مجموعه آماده استفاده است ✓" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "باز کردن سایت" }),
    ).toBeVisible();
    const newTenantSite = await page.context().newPage();
    const homeResponse = await newTenantSite.goto(
      `http://${slug}.localhost:${e2ePort}`,
    );
    expect(homeResponse?.status()).toBe(200);
    await expect(
      newTenantSite.getByRole("heading", {
        name: "EventOS E2E Organization",
        exact: true,
      }),
    ).toBeVisible();
    const loginResponse = await newTenantSite.goto(
      `http://${slug}.localhost:${e2ePort}/login`,
    );
    expect(loginResponse?.status()).toBe(200);
    await newTenantSite.close();

    await page
      .getByLabel("نام نمایشی", { exact: true })
      .fill("EventOS E2E Configured");
    await page.getByRole("button", { name: "ذخیرهٔ مشخصات" }).click();
    await expect(
      page.getByRole("heading", { name: "EventOS E2E Configured" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("اطلاعات سازمان ذخیره شد.")).toBeVisible();

    await page.getByRole("checkbox", { name: "دامنهٔ اختصاصی" }).check();
    await page.getByRole("button", { name: "ذخیرهٔ قابلیت‌ها" }).click();
    await expect(
      page.getByText("قابلیت‌های سازمان به‌روزرسانی شد."),
    ).toBeVisible();

    await page.getByLabel("دامنه‌های اختصاصی").fill("1");
    await page.getByRole("button", { name: "ذخیرهٔ محدودیت‌ها" }).click();
    await expect(page.getByText("سقف‌های استفاده ذخیره شد.")).toBeVisible();

    await page.getByLabel("نام برند").fill("EventOS E2E Brand");
    await page.getByLabel("رنگ اصلی").fill("#145D58");
    await page.getByLabel("رنگ تأکیدی").fill("#C99047");
    await page.getByRole("button", { name: "ذخیرهٔ برند" }).click();
    await expect(page.getByText("تنظیمات برند ذخیره شد.")).toBeVisible();
    const googleDisabledContext = await browser.newContext();
    try {
      const googleDisabledPage = await googleDisabledContext.newPage();
      await googleDisabledPage.goto(
        `http://${slug}.localhost:${e2ePort}/login`,
      );
      await expect(
        googleDisabledPage.getByRole("button", { name: "ادامه با گوگل" }),
      ).toHaveCount(0);
      expect(
        await googleDisabledPage.evaluate(
          async () =>
            (
              await fetch("/api/tenant-auth/sign-in/social", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  provider: "google",
                  callbackURL: "/auth/continue",
                }),
              })
            ).status,
        ),
      ).toBe(403);
    } finally {
      await googleDisabledContext.close();
    }
    const crmEnabled = await page.evaluate(async (id) => {
      const response = await fetch(`/api/platform/tenants/${id}/features`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides: [
            { key: "crm", enabled: true },
            { key: "courses", enabled: true },
            { key: "events", enabled: true },
            { key: "attendance", enabled: true },
            { key: "qr_attendance", enabled: true },
            { key: "certificates", enabled: true },
            { key: "payments", enabled: true },
            { key: "email_otp", enabled: true },
            { key: "google_login", enabled: true },
          ],
        }),
      });
      return response.status;
    }, tenantId);
    expect(crmEnabled).toBe(200);
    const googleEnabledContext = await browser.newContext();
    try {
      const googleEnabledPage = await googleEnabledContext.newPage();
      await googleEnabledPage.goto(`http://${slug}.localhost:${e2ePort}/login`);
      await expect
        .poll(
          async () => {
            await googleEnabledPage.reload();
            return googleEnabledPage
              .getByRole("button", { name: "ادامه با گوگل" })
              .count();
          },
          { timeout: 20_000, intervals: [1_000] },
        )
        .toBe(1);
    } finally {
      await googleEnabledContext.close();
    }
    expect(
      await page.evaluate(async (id) => {
        const response = await fetch(
          `/api/platform/tenants/${id}/payment-providers`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ providerKey: "TEST", allowed: true }),
          },
        );
        return response.status;
      }, tenantId),
    ).toBe(200);

    const e2eState = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "tests", ".e2e-state.json"),
        "utf8",
      ),
    ) as E2eState;
    if (!e2eState.mailOutboxPath)
      throw new Error("E2E invitation outbox is unavailable.");
    expect(path.resolve(process.env.EVENTOS_TEST_MAIL_OUTBOX ?? "")).toBe(
      path.resolve(e2eState.mailOutboxPath),
    );
    const outboxEntries = readFileSync(e2eState.mailOutboxPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { email: string; inviteUrl: string });
    const invitation = outboxEntries.find(
      (entry) => entry.email.toLowerCase() === ownerEmail.toLowerCase(),
    );
    if (!invitation)
      throw new Error(
        `The initial tenant owner invitation was not delivered (${outboxEntries.length} outbox entries).`,
      );
    const inviteToken = new URL(invitation.inviteUrl).searchParams.get("token");
    if (!inviteToken)
      throw new Error("The owner activation link was malformed.");
    const tenantOrigin = `http://${slug}.localhost:${e2ePort}`;
    const invitationUrl = `${tenantOrigin}/accept-invitation?token=${encodeURIComponent(inviteToken)}`;
    await page.goto(invitationUrl);
    await page.getByLabel("گذرواژهٔ تازه").fill("tenant owner e2e password");
    await page.getByLabel("تکرار گذرواژه").fill("tenant owner e2e password");
    await page.getByRole("button", { name: "فعال‌سازی حساب" }).click();
    await expect(page.getByRole("status")).toContainText("حساب شما فعال شد");
    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("ایمیل", { exact: true }).fill(ownerEmail);
    await page
      .getByLabel("گذرواژه", { exact: true })
      .fill("tenant owner e2e password");
    await page.getByRole("button", { name: "ورود امن" }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: `سلام ${ownerName}` }),
    ).toBeVisible();
    await page.goto(`${tenantOrigin}/website`);
    await page.getByLabel("معرفی کوتاه").fill("معرفی تازه مجموعه آزمایشی");
    await page.getByRole("button", { name: "تماس با ما", exact: true }).click();
    await page.getByLabel("تلفن عمومی").fill("021-12345678");
    await page.getByRole("button", { name: "هویت بصری" }).click();
    await page.getByLabel("رنگ اصلی").fill("#145d58");
    await page
      .getByRole("group", { name: "قالب سایت" })
      .getByRole("radio", { name: "حرفه‌ای ساختار و اعتبار" })
      .check();
    await page
      .getByRole("group", { name: "سبک کارت رویداد" })
      .getByRole("radio", { name: "مشروح" })
      .check();
    if (process.env.EVENTOS_VISUAL_CAPTURE === "true") {
      const originalViewport = page.viewportSize();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: "test-results/step36-website-editor-1440.png",
        fullPage: true,
      });
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
    await page
      .locator(".media-uploader")
      .filter({ hasText: "لوگو" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: tinyPng,
      });
    await expect(
      page
        .locator(".media-uploader")
        .filter({ hasText: "لوگو" })
        .locator("img"),
    ).toBeVisible();
    await page.getByRole("button", { name: "بخش‌ها" }).click();
    await page
      .locator("section:not([hidden]) .website-section-row")
      .filter({ hasText: "درباره ما" })
      .getByRole("checkbox")
      .uncheck();
    await page
      .locator("section:not([hidden]) .website-section-row")
      .filter({ hasText: "سوالات متداول" })
      .getByRole("checkbox")
      .check();
    await page
      .getByRole("button", { name: "سوالات متداول", exact: true })
      .click();
    await page.getByLabel("پرسش").fill("چگونه ثبت‌نام کنم؟");
    await page.getByLabel("پاسخ").fill("از صفحه رویداد ثبت‌نام کنید.");
    await page
      .locator(".site-content-editor")
      .getByRole("checkbox", { name: "نمایش عمومی" })
      .check();
    await page.getByRole("button", { name: "ذخیره مورد" }).click();
    await expect(page.locator(".site-content-editor [role=status]")).toHaveText(
      "ذخیره شد.",
    );
    await page.getByRole("button", { name: "صفحات", exact: true }).click();
    await page.getByLabel("عنوان صفحه").fill("قوانین ثبت‌نام");
    await page.getByLabel("شناسه صفحه").fill("registration-rules");
    await page.getByLabel("انتشار صفحه").check();
    await page.getByLabel("افزودن بلوک").selectOption("text");
    await page
      .locator(".site-block-editor textarea")
      .fill("قوانین ثبت‌نام آزمایشی");
    await page.getByRole("button", { name: "ذخیره مورد" }).click();
    await expect(page.locator(".site-content-editor [role=status]")).toHaveText(
      "ذخیره شد.",
    );
    await page.getByRole("button", { name: "منو", exact: true }).click();
    await page
      .locator("section:not([hidden]) .website-section-row")
      .filter({ hasText: "سوالات متداول" })
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("status")).toHaveText("تغییرات ذخیره شد.");
    await page.goto(`${tenantOrigin}/`);
    await expect(
      page.getByText("معرفی تازه مجموعه آزمایشی").first(),
    ).toBeVisible();
    expect(
      await page
        .locator(".public-site")
        .evaluate((element) =>
          (element as HTMLElement).style.getPropertyValue("--public-primary"),
        ),
    ).toBe("#145d58");
    await expect(page.locator(".public-logo img")).toBeVisible();
    await expect(page.locator(".public-site")).toHaveClass(
      /public-template-professional/,
    );
    await expect(page.locator(".public-about-band")).toHaveCount(0);
    await expect(page.getByText("چگونه ثبت‌نام کنم؟")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "قوانین ثبت‌نام" }),
    ).toBeVisible();
    await page.goto(`${tenantOrigin}/pages/registration-rules`);
    await expect(page.getByText("قوانین ثبت‌نام آزمایشی")).toBeVisible();
    await page.goto(`${tenantOrigin}/faq`);
    await expect(page.getByText("چگونه ثبت‌نام کنم؟")).toBeVisible();
    await page.goto(`${tenantOrigin}/contact`);
    await expect(
      page.getByRole("main").getByText("021-12345678"),
    ).toBeVisible();
    await page.goto(`${tenantOrigin}/dashboard`);
    expect(
      await page.evaluate(
        async () => (await fetch("/api/tenant/roles")).status,
      ),
    ).toBe(200);

    const tenantCookies = await page.context().cookies(tenantOrigin);
    const ownerCookie = tenantCookies.find((cookie) =>
      cookie.name.endsWith("session_token"),
    );
    expect(ownerCookie).toBeDefined();
    if (!ownerCookie)
      throw new Error(
        `Tenant owner session was unavailable; cookie names: ${tenantCookies.map((cookie) => cookie.name).join(", ") || "none"}.`,
      );

    await page
      .locator(".sidebar .nav-group summary")
      .filter({ hasText: "مدیریت" })
      .click();
    await page.getByRole("link", { name: "نقش‌ها و دسترسی‌ها" }).first().click();
    await expect(page.locator(".permission-group-title").first()).toBeVisible();
    await expect(page.getByText("دسترسی پرخطر").first()).toBeVisible();
    await page.getByLabel("شناسه").fill("e2e_read_only_staff");
    await page.getByLabel("نام", { exact: true }).fill("Read-only staff");
    await page.getByLabel("توضیح").fill("Read-only staff access for E2E.");
    await page
      .locator("label.check-row")
      .filter({ hasText: "مشاهده کارکنان" })
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "ایجاد نقش" }).click();
    await expect(page.getByRole("status")).toContainText("نقش ایجاد شد");
    await expect(
      page.getByRole("heading", { name: "Read-only staff" }),
    ).toBeVisible();

    yield "provisioning and tenant branding";

    const staffName = "E2E Read Only Staff";
    const staffEmail = `staff-${randomUUID()}@example.test`;
    await page
      .locator(".sidebar .nav-group summary")
      .filter({ hasText: "افراد" })
      .click();
    await page
      .locator(".sidebar")
      .getByRole("link", { name: "کارکنان" })
      .click();
    const staffForm = page.locator("form").filter({ hasText: "دعوت کاربر" });
    await expect(
      staffForm.getByRole("checkbox", { name: "Read-only staff" }),
    ).toBeVisible();
    const staffRoleBoxes = staffForm.locator('input[type="checkbox"]');
    for (let index = 0; index < (await staffRoleBoxes.count()); index += 1) {
      const checkbox = staffRoleBoxes.nth(index);
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    await staffForm.getByRole("checkbox", { name: "Read-only staff" }).check();
    await staffForm.locator("#invite-name").fill(staffName);
    await staffForm.locator("#invite-email").fill(staffEmail);
    await staffForm.getByRole("button", { name: "ارسال دعوت" }).click();
    await expect(page.getByRole("status")).toContainText("پیوند فعال‌سازی");

    if (!e2eState.mailOutboxPath)
      throw new Error("E2E invitation outbox is unavailable.");
    const readInvitation = (email: string) =>
      readFileSync(e2eState.mailOutboxPath as string, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { email: string; inviteUrl: string })
        .find((entry) => entry.email === email);
    const staffInvitation = readInvitation(staffEmail);
    if (!staffInvitation)
      throw new Error("The staff invitation was not delivered.");
    const staffToken = new URL(staffInvitation.inviteUrl).searchParams.get(
      "token",
    );
    if (!staffToken)
      throw new Error("The staff activation link was malformed.");

    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await staffPage.goto(
      `${tenantOrigin}/accept-invitation?token=${encodeURIComponent(staffToken)}`,
    );
    await staffPage.getByLabel("گذرواژهٔ تازه").fill("staff e2e password long");
    await staffPage.getByLabel("تکرار گذرواژه").fill("staff e2e password long");
    await staffPage.getByRole("button", { name: "فعال‌سازی حساب" }).click();
    await expect(staffPage.getByRole("status")).toContainText(
      "حساب شما فعال شد",
    );
    await staffPage.goto(`${tenantOrigin}/login`);
    await staffPage.getByLabel("ایمیل", { exact: true }).fill(staffEmail);
    await staffPage
      .getByLabel("گذرواژه", { exact: true })
      .fill("staff e2e password long");
    await staffPage.getByRole("button", { name: "ورود امن" }).click();
    await staffPage.waitForURL("**/dashboard");
    await staffPage
      .locator(".sidebar .nav-group summary")
      .filter({ hasText: "افراد" })
      .click();
    await expect(
      staffPage.locator(".sidebar").getByRole("link", { name: "کارکنان" }),
    ).toBeVisible();
    await expect(
      staffPage.getByRole("link", { name: "نقش‌ها و دسترسی‌ها" }),
    ).toHaveCount(0);
    expect(
      await staffPage.evaluate(
        async () => (await fetch("/api/tenant/identity/staff")).status,
      ),
    ).toBe(200);
    expect(
      await staffPage.evaluate(
        async () => (await fetch("/api/tenant/roles")).status,
      ),
    ).toBe(403);
    expect(
      await staffPage.evaluate(
        async () => (await fetch("/api/tenant/programs")).status,
      ),
    ).toBe(403);
    await staffPage
      .locator(".sidebar")
      .getByRole("link", { name: "کارکنان" })
      .click();
    await expect(
      staffPage.getByRole("button", { name: "ارسال دعوت" }),
    ).toHaveCount(0);

    await page.goto(`${tenantOrigin}/staff`);
    await page.getByLabel(`وضعیت ${staffName}`).selectOption("SUSPENDED");
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: staffName })
        .getByText("SUSPENDED", { exact: true }),
    ).toBeVisible();
    expect(
      await staffPage.evaluate(
        async () => (await fetch("/api/tenant/identity/staff")).status,
      ),
    ).toBe(401);
    await staffContext.close();

    async function invitePortalIdentity(
      collection: "instructors" | "participants",
      name: string,
      email: string,
      retainSession = false,
    ) {
      await page.goto(
        `${tenantOrigin}/${collection === "instructors" ? "manage/instructors" : collection}`,
      );
      await page.locator("#invite-name").fill(name);
      await page.locator("#invite-email").fill(email);
      await page.getByRole("button", { name: "ارسال دعوت" }).click();
      await expect(page.getByRole("status")).toContainText("پیوند فعال‌سازی");
      const invitation = readInvitation(email);
      if (!invitation)
        throw new Error(`The ${collection} invitation was not delivered.`);
      const token = new URL(invitation.inviteUrl).searchParams.get("token");
      if (!token) throw new Error(`The ${collection} link was malformed.`);
      const portalContext = await browser.newContext();
      const portalPage = await portalContext.newPage();
      await portalPage.goto(
        `${tenantOrigin}/accept-invitation?token=${encodeURIComponent(token)}`,
      );
      await portalPage
        .getByLabel("گذرواژهٔ تازه")
        .fill("portal e2e password long");
      await portalPage
        .getByLabel("تکرار گذرواژه")
        .fill("portal e2e password long");
      await portalPage.getByRole("button", { name: "فعال‌سازی حساب" }).click();
      await expect(portalPage.getByRole("status")).toContainText(
        "حساب شما فعال شد",
      );
      await portalPage.goto(`${tenantOrigin}/login`);
      await portalPage.getByLabel("ایمیل", { exact: true }).fill(email);
      await portalPage
        .getByLabel("گذرواژه", { exact: true })
        .fill("portal e2e password long");
      await portalPage.getByRole("button", { name: "ورود امن" }).click();
      await portalPage.waitForURL(
        collection === "participants" ? "**/account" : "**/dashboard",
        { timeout: 15_000 },
      );
      await expect(
        portalPage.getByRole("heading", {
          name:
            collection === "participants" ? `سلام، ${name}` : `سلام ${name}`,
        }),
      ).toBeVisible();
      expect(
        await portalPage.evaluate(
          async () => (await fetch("/api/tenant/identity/staff")).status,
        ),
      ).toBe(403);
      const deniedPortal = await portalPage.goto(`${tenantOrigin}/staff`);
      expect(deniedPortal?.status()).toBe(404);
      if (retainSession) return { context: portalContext, page: portalPage };
      await portalContext.close();
      return null;
    }

    const phase3InstructorEmail = `instructor-${randomUUID()}@example.test`;
    const unrelatedInstructorEmail = `instructor-${randomUUID()}@example.test`;
    const phase3InstructorSession = await invitePortalIdentity(
      "instructors",
      "E2E Instructor Identity",
      phase3InstructorEmail,
      true,
    );
    if (!phase3InstructorSession)
      throw new Error("Instructor session fixture was incomplete.");
    await invitePortalIdentity(
      "instructors",
      "Unrelated E2E Instructor",
      unrelatedInstructorEmail,
    );
    const publicInstructorId = await page.evaluate(async (email) => {
      const payload = (await (
        await fetch("/api/tenant/identity/instructors")
      ).json()) as {
        data: { id: string; email: string }[];
      };
      return payload.data.find((item) => item.email === email)?.id ?? "";
    }, phase3InstructorEmail);
    expect(publicInstructorId).toBeTruthy();
    await page.goto(`${tenantOrigin}/manage/instructors/${publicInstructorId}`);
    await page.getByLabel("عنوان حرفه‌ای").fill("مدرس ارشد آزمایشی");
    await page.getByLabel("معرفی کوتاه").fill("مدرس باتجربه در آموزش رویداد");
    await page
      .getByLabel("زندگی‌نامه")
      .fill("سابقه تدریس و برگزاری دوره‌های آموزشی.");
    await page
      .getByLabel("تخصص‌ها (هر خط یک مورد)")
      .fill("آموزش\nمدیریت رویداد");
    await page.getByRole("button", { name: "+ افزودن سابقه" }).click();
    await page.getByLabel("سمت").fill("مدرس");
    await page
      .getByRole("textbox", { name: "سازمان", exact: true })
      .fill("مجموعه آزمایشی");
    await page.getByRole("button", { name: "+ افزودن تحصیلات" }).click();
    await page.getByLabel("مدرک").fill("کارشناسی");
    await page.getByLabel("رشته").fill("آموزش");
    await page.getByLabel("مؤسسه").fill("دانشگاه نمونه");
    await page.getByRole("button", { name: "ذخیره پروفایل" }).click();
    await expect(page.getByRole("status")).toHaveText("پروفایل ذخیره شد.");
    await page
      .locator(".media-uploader")
      .filter({ hasText: "تصویر مدرس" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "instructor.png",
        mimeType: "image/png",
        buffer: tinyPng,
      });
    await expect(
      page
        .locator(".media-uploader")
        .filter({ hasText: "تصویر مدرس" })
        .locator("img"),
    ).toBeVisible();
    await page
      .locator(".media-uploader")
      .filter({ hasText: "رزومه PDF" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n1 0 obj\nendobj\n%%EOF"),
      });
    await expect(
      page
        .locator(".media-uploader")
        .filter({ hasText: "رزومه PDF" })
        .getByText("رزومهٔ بارگذاری‌شده (PDF)"),
    ).toBeVisible();
    await page.getByLabel("نمایش لینک رزومه پس از انتشار").check();
    await page.getByLabel("انتشار پروفایل عمومی").check();
    await page.getByRole("button", { name: "ذخیره پروفایل" }).click();
    await expect(page.getByRole("status")).toHaveText("پروفایل ذخیره شد.");
    const publicInstructorSlug = await page
      .getByLabel("شناسه صفحه")
      .inputValue();
    await page.goto(`${tenantOrigin}/instructors`);
    await expect(
      page.getByRole("link", { name: "E2E Instructor Identity" }).first(),
    ).toBeVisible();
    await page.goto(`${tenantOrigin}/instructors/${publicInstructorSlug}`);
    await expect(page.getByText("مدرس ارشد آزمایشی")).toBeVisible();
    if (process.env.EVENTOS_VISUAL_CAPTURE === "true") {
      const originalViewport = page.viewportSize();
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 850 });
        await page.screenshot({
          path: `test-results/instructor-profile-${width}.png`,
          fullPage: true,
        });
      }
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
    await expect(
      page.getByRole("heading", { name: "سوابق کاری" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "تحصیلات" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "دریافت رزومه" }),
    ).toBeVisible();
    await expect(page.getByText(phase3InstructorEmail)).toHaveCount(0);
    const phase5ParticipantEmail = `participant-${randomUUID()}@example.test`;
    const phase5ParticipantSession = await invitePortalIdentity(
      "participants",
      "E2E Participant Identity",
      phase5ParticipantEmail,
      true,
    );
    if (!phase5ParticipantSession)
      throw new Error("Participant session fixture was incomplete.");

    yield "tenant RBAC and invited identities";

    const phase3ProgramTitle = `کارگاه آزمایشی ${randomUUID().slice(0, 8)}`;
    const phase3RunTitle = `اجرای آزمایشی ${randomUUID().slice(0, 8)}`;
    const phase3SessionTitle = "جلسه مدرس اول";
    const unrelatedSessionTitle = "جلسه مدرس دوم";
    await page.goto(`${tenantOrigin}/programs`);
    await page.getByRole("button", { name: "برنامه جدید" }).click();
    await page.locator('input[name="title"]').fill(phase3ProgramTitle);
    await page
      .locator('input[name="slug"]')
      .fill(`phase3-${randomUUID().slice(0, 8)}`);
    await page.locator('select[name="type"]').selectOption("WORKSHOP");
    await page.getByRole("button", { name: "ذخیره", exact: true }).click();
    await expect(
      page.getByRole("row").filter({ hasText: phase3ProgramTitle }),
    ).toBeVisible();
    await page
      .locator(".media-uploader")
      .filter({ hasText: "تصویر شاخص / کاور" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "cover.png",
        mimeType: "image/png",
        buffer: tinyPng,
      });
    await expect(
      page
        .locator(".media-uploader")
        .filter({ hasText: "تصویر شاخص / کاور" })
        .locator("img"),
    ).toBeVisible();
    const firstCoverUrl = await page.evaluate(async (title) => {
      const payload = await (await fetch("/api/tenant/programs")).json();
      return (
        (payload.data as { title: string; cover_url: string | null }[]).find(
          (program) => program.title === title,
        )?.cover_url ?? ""
      );
    }, phase3ProgramTitle);
    expect(firstCoverUrl).toMatch(/^\/api\/media\//);
    await page
      .getByRole("row")
      .filter({ hasText: phase3ProgramTitle })
      .getByRole("button", { name: "فعال‌سازی" })
      .click();
    const phase3ProgramId = await page.evaluate(async (title) => {
      const payload = (await (await fetch("/api/tenant/programs")).json()) as {
        data: { id: string; title: string }[];
      };
      return payload.data.find((program) => program.title === title)?.id ?? "";
    }, phase3ProgramTitle);
    expect(phase3ProgramId).toBeTruthy();

    await page.goto(`${tenantOrigin}/venues`);
    await page.getByRole("button", { name: "مکان جدید" }).click();
    await page
      .locator('form input[name="name"]')
      .fill("مرکز آموزشی آزمایشی E2E");
    await page.locator('form input[name="city"]').fill("اصفهان");
    await page.getByRole("button", { name: "ذخیره", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "مرکز آموزشی آزمایشی E2E" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "افزودن کلاس" }).click();
    await page.locator('form input[name="name"]').fill("کلاس E2E");
    await page.locator('form input[name="capacity"]').fill("30");
    await page.getByRole("button", { name: "ذخیره کلاس" }).click();
    await expect(page.getByText("کلاس E2E", { exact: true })).toBeVisible();
    const phase3Options = await page.evaluate(async () => {
      const [people, places] = await Promise.all([
        fetch("/api/tenant/identity/instructors").then((response) =>
          response.json(),
        ),
        fetch("/api/tenant/venues").then((response) => response.json()),
      ]);
      return {
        people: people.data as { id: string; email: string }[],
        places: places.data as {
          id: string;
          name: string;
          rooms: { id: string; name: string }[];
        }[],
      };
    });
    const firstInstructorId = phase3Options.people.find(
      (person) => person.email === phase3InstructorEmail,
    )?.id;
    const secondInstructorId = phase3Options.people.find(
      (person) => person.email === unrelatedInstructorEmail,
    )?.id;
    const place = phase3Options.places.find(
      (item) => item.name === "مرکز آموزشی آزمایشی E2E",
    );
    expect(firstInstructorId).toBeTruthy();
    expect(secondInstructorId).toBeTruthy();
    expect(place).toBeTruthy();
    if (!firstInstructorId || !secondInstructorId || !place)
      throw new Error("Phase 3 E2E fixture was incomplete.");
    const roomId = place.rooms.find((room) => room.name === "کلاس E2E")?.id;
    if (!roomId) throw new Error("Phase 3 E2E room was missing.");
    const baseDay = new Date(Date.now() + 20 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const laterDay = new Date(Date.now() + 21 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const runEndDay = new Date(Date.now() + 45 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await page.goto(`${tenantOrigin}/runs`);
    await page.getByRole("button", { name: "اجرای جدید" }).click();
    await page
      .locator('select[name="programId"]')
      .selectOption(phase3ProgramId);
    await page.locator('input[name="title"]').fill(phase3RunTitle);
    await setJalali(page, 0, `${baseDay}T08:00`);
    await setJalali(page, 1, `${runEndDay}T20:00`);
    await page.locator('input[name="capacity"]').fill("24");
    await page.locator('select[name="venueId"]').selectOption(place.id);
    await page
      .locator('select[name="instructorIds"]')
      .selectOption(firstInstructorId);
    await page.getByRole("button", { name: "ذخیره", exact: true }).click();
    await expect(
      page.getByRole("row").filter({ hasText: phase3RunTitle }),
    ).toBeVisible();
    const phase3RunId = await page.evaluate(async (title) => {
      const payload = (await (await fetch("/api/tenant/runs")).json()) as {
        data: { id: string; title: string }[];
      };
      return payload.data.find((run) => run.title === title)?.id ?? "";
    }, phase3RunTitle);
    expect(phase3RunId).toBeTruthy();

    await page.goto(`${tenantOrigin}/sessions`);
    for (const [title, date, instructorId] of [
      [phase3SessionTitle, baseDay, firstInstructorId],
      [unrelatedSessionTitle, laterDay, secondInstructorId],
    ] as [string, string, string][]) {
      await page.getByRole("button", { name: "جلسه جدید" }).click();
      await page.locator('select[name="runId"]').selectOption(phase3RunId);
      await page.locator('input[name="title"]').fill(title);
      await setJalali(page, 0, `${date}T10:00`);
      await setJalali(page, 1, `${date}T12:00`);
      await page.locator('select[name="venueId"]').selectOption(place.id);
      await page.locator('select[name="roomId"]').selectOption(roomId);
      await page
        .locator('select[name="instructorIds"]')
        .selectOption(instructorId);
      await page.getByRole("button", { name: "ثبت جلسه" }).click();
      await expect(
        page.getByRole("row").filter({ hasText: title }),
      ).toBeVisible();
    }
    const unrelatedSessionId = await page.evaluate(async (title) => {
      const payload = (await (await fetch("/api/tenant/sessions")).json()) as {
        data: { id: string; title: string }[];
      };
      return payload.data.find((session) => session.title === title)?.id ?? "";
    }, unrelatedSessionTitle);
    expect(unrelatedSessionId).toBeTruthy();
    await page.goto(`${tenantOrigin}/runs`);
    await page
      .getByRole("row")
      .filter({ hasText: phase3RunTitle })
      .getByRole("button", { name: "انتشار" })
      .click();
    await expect(
      page.getByRole("row").filter({ hasText: phase3RunTitle }),
    ).toContainText("منتشرشده");
    await phase5ParticipantSession.page.goto(
      `${tenantOrigin}/events/${phase3RunId}`,
    );
    await phase5ParticipantSession.page
      .getByRole("button", { name: "ثبت‌نام در دوره" })
      .click();
    await expect(
      phase5ParticipantSession.page.getByRole("status"),
    ).toContainText("ثبت‌نام شما تأیید شد");
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${tenantOrigin}/`);
    await expect(publicPage.getByRole("heading", { level: 1 })).toBeVisible();
    await publicPage.goto(`${tenantOrigin}/events`);
    await expect(publicPage.getByText(phase3RunTitle).first()).toBeVisible();
    await publicPage.goto(`${tenantOrigin}/events/${phase3RunId}`);
    await expect(
      publicPage.getByRole("heading", { name: phase3RunTitle }),
    ).toBeVisible();
    await expect(publicPage.locator(".public-event-cover")).toBeVisible();
    await expect(
      publicPage.getByRole("link", { name: "مشاهده رزومه کامل مدرس" }),
    ).toHaveAttribute("href", `/instructors/${publicInstructorSlug}`);
    await expect(
      publicPage.getByRole("heading", { name: "برنامه جلسات" }),
    ).toBeVisible();
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await expect(
      publicPage.getByRole("link", { name: "ثبت‌نام در دوره" }),
    ).toBeVisible();
    expect(
      await publicPage.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
    for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
      await publicPage.setViewportSize({ width, height: 850 });
      for (const path of [
        "/",
        "/events",
        `/events/${phase3RunId}`,
        "/instructors",
        `/instructors/${publicInstructorSlug}`,
        "/about",
        "/contact",
        "/faq",
      ]) {
        await publicPage.goto(`${tenantOrigin}${path}`);
        expect(
          await publicPage.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          `${path} overflowed at ${width}px`,
        ).toBe(true);
      }
    }
    await publicContext.close();
    yield "program creation and public enrollment";

    await runPhase6BrowserFlows({
      ownerPage: page,
      participantPage: phase5ParticipantSession.page,
      otherParticipantPage: phase3InstructorSession.page,
      otherParticipantEmail: phase3InstructorEmail,
      tenantOrigin,
      tenantId,
      sourceRunId: phase3RunId,
    });
    yield "payment browser flows";

    await runPilotAuthBrowserFlows({
      browser,
      tenantId,
      tenantOrigin,
      sourceRunId: phase3RunId,
      participantEmail: phase5ParticipantEmail,
      mailOutboxPath: e2eState.mailOutboxPath ?? "",
    });
    yield "pilot authentication flows";

    await runPilotGoogleNewUserFlow({
      browser,
      tenantId,
      tenantOrigin,
      sourceRunId: phase3RunId,
      participantEmail: phase5ParticipantEmail,
      mailOutboxPath: e2eState.mailOutboxPath ?? "",
    });
    yield "pilot Google new participant";

    await page.goto(`${tenantOrigin}/calendar`);
    const calendarControl = new Client({
      connectionString: process.env.CONTROL_DATABASE_URL,
    });
    await calendarControl.connect();
    let tenantTimezone: string;
    try {
      const tenantRow = await calendarControl.query<{ timezone: string }>(
        "SELECT timezone FROM tenants WHERE id=$1",
        [tenantId],
      );
      tenantTimezone = tenantRow.rows[0]?.timezone ?? "";
    } finally {
      await calendarControl.end();
    }
    expect(tenantTimezone).toBeTruthy();
    const calendarSession = await page.evaluate(async (title) => {
      const response = await fetch("/api/tenant/sessions");
      const payload = (await response.json()) as {
        data: {
          title: string;
          tenant_id: string;
          status: string;
          starts_at: string;
        }[];
      };
      return {
        status: response.status,
        session: payload.data.find((session) => session.title === title),
      };
    }, phase3SessionTitle);
    expect(calendarSession.status).toBe(200);
    expect(calendarSession.session).toMatchObject({
      title: phase3SessionTitle,
      tenant_id: tenantId,
      status: "SCHEDULED",
      starts_at: tenantWallTimeToUtc(`${baseDay}T10:00`, tenantTimezone),
    });
    if (!calendarSession.session)
      throw new Error(
        "The expected calendar session was not returned by the tenant API.",
      );
    await navigateCalendarToDate(
      page,
      calendarSession.session.starts_at,
      tenantTimezone,
    );
    await expect(page.getByText(phase3SessionTitle)).toBeVisible();

    const instructorPage = phase3InstructorSession.page;
    await instructorPage.goto(`${tenantOrigin}/sessions`);
    await expect(instructorPage.getByText(phase3SessionTitle)).toBeVisible();
    await expect(instructorPage.getByText(unrelatedSessionTitle)).toHaveCount(
      0,
    );
    expect(
      await instructorPage.evaluate(
        async (id) => (await fetch(`/api/tenant/sessions/${id}`)).status,
        unrelatedSessionId,
      ),
    ).toBe(404);
    await phase3InstructorSession.context.close();

    const phase5Control = new Client({
      connectionString: process.env.CONTROL_MIGRATION_DATABASE_URL,
    });
    await phase5Control.connect();
    const registered = await phase5Control.query<{ database_name: string }>(
      "SELECT database_name FROM tenant_database_registry WHERE tenant_id=$1",
      [tenantId],
    );
    await phase5Control.end();
    const databaseName = registered.rows[0]?.database_name;
    if (!databaseName)
      throw new Error("E2E tenant database was not registered.");
    const phase5Url = new URL(process.env.TENANT_MIGRATION_DATABASE_URL ?? "");
    phase5Url.pathname = `/${databaseName}`;
    const phase5Db = new Client({ connectionString: phase5Url.toString() });
    await phase5Db.connect();
    try {
      await phase5Db.query(
        "UPDATE program_sessions SET starts_at=$3,ends_at=$4 WHERE tenant_id=$1 AND title=$2",
        [
          tenantId,
          phase3SessionTitle,
          new Date(Date.now() - 2 * 60 * 60_000),
          new Date(Date.now() - 60 * 60_000),
        ],
      );
    } finally {
      await phase5Db.end();
    }

    await page.goto(`${tenantOrigin}/attendance`);
    await expect(
      page.getByRole("heading", { name: "حضور و غیاب" }),
    ).toBeVisible();
    await page
      .getByRole("row")
      .filter({ hasText: phase3SessionTitle })
      .getByRole("link", { name: "ثبت و مشاهده" })
      .click();
    await expect(
      page.getByRole("heading", { name: "خلاصه حضور" }),
    ).toBeVisible();
    await page
      .getByLabel("وضعیت E2E Participant Identity")
      .selectOption("PRESENT");
    await page
      .getByLabel("یادداشت E2E Participant Identity")
      .fill("حضور تأیید شد");
    await page.getByRole("button", { name: "ثبت حضور این صفحه" }).click();
    await expect(page.getByRole("status")).toContainText("حضور ثبت شد");
    await expect(page.getByText("حاضر: 1", { exact: false })).toBeVisible();
    await page.goto(`${tenantOrigin}/attendance`);
    await expect(
      page.getByRole("row").filter({ hasText: "E2E Participant Identity" }),
    ).toContainText("100٪");
    await phase5ParticipantSession.page.goto(`${tenantOrigin}/account`);
    await expect(
      phase5ParticipantSession.page.getByRole("heading", { name: "حضور من" }),
    ).toBeVisible();
    await expect(
      phase5ParticipantSession.page.getByText(phase3SessionTitle),
    ).toBeVisible();

    const phase5Completion = new Client({
      connectionString: phase5Url.toString(),
    });
    await phase5Completion.connect();
    try {
      await phase5Completion.query(
        "UPDATE program_runs SET state='COMPLETED' WHERE tenant_id=$1 AND id=$2",
        [tenantId, phase3RunId],
      );
    } finally {
      await phase5Completion.end();
    }
    await page.goto(`${tenantOrigin}/certificates`);
    await expect(
      page.getByRole("heading", { name: "گواهی‌ها", exact: true }),
    ).toBeVisible();
    await page.getByLabel("نام قالب").fill("قالب آزمون E2E");
    await page.getByRole("button", { name: "ساخت قالب" }).click();
    await expect(page.getByRole("status")).toContainText("قالب ساخته شد");
    await page
      .getByLabel("شرکت‌کننده و اجرا")
      .selectOption({ label: `E2E Participant Identity · ${phase3RunTitle}` });
    await page.getByRole("button", { name: "صدور", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("گواهی صادر شد");
    await expect(
      page.getByRole("row").filter({ hasText: "E2E Participant Identity" }),
    ).toContainText("معتبر");
    await phase5ParticipantSession.page.goto(`${tenantOrigin}/account`);
    await expect(
      phase5ParticipantSession.page.getByRole("heading", {
        name: "گواهی‌های من",
      }),
    ).toBeVisible();
    const verificationDb = new Client({
      connectionString: phase5Url.toString(),
    });
    await verificationDb.connect();
    let publicCode = "";
    try {
      const result = await verificationDb.query<{ verification_code: string }>(
        "SELECT verification_code FROM certificates WHERE tenant_id=$1 AND run_id=$2",
        [tenantId, phase3RunId],
      );
      publicCode = result.rows[0]?.verification_code ?? "";
    } finally {
      await verificationDb.end();
    }
    if (!publicCode)
      throw new Error("E2E certificate verification code was missing.");
    const verificationContext = await browser.newContext();
    const verificationPage = await verificationContext.newPage();
    await verificationPage.goto(`${tenantOrigin}/certificate/${publicCode}`);
    await expect(
      verificationPage.getByRole("heading", { name: "گواهی معتبر است" }),
    ).toBeVisible();
    await expect(
      verificationPage.getByText("E2E Participant Identity"),
    ).toBeVisible();
    await page
      .getByRole("row")
      .filter({ hasText: "E2E Participant Identity" })
      .getByRole("button", { name: "لغو" })
      .click();
    await expect(page.getByRole("status")).toContainText("گواهی لغو شد");
    await verificationPage.reload();
    await expect(
      verificationPage.getByRole("heading", { name: "گواهی معتبر یافت نشد" }),
    ).toBeVisible();
    await verificationContext.close();
    await phase5ParticipantSession.context.close();

    yield "attendance and certificates";

    const wrongHostEmail = `wrong-host-${randomUUID()}@example.test`;
    await page.goto(`${tenantOrigin}/staff`);
    await page.locator("#invite-name").fill("Wrong Host Invite");
    await page.locator("#invite-email").fill(wrongHostEmail);
    await page.getByRole("button", { name: "ارسال دعوت" }).click();
    await expect(page.getByRole("status")).toContainText("پیوند فعال‌سازی");
    const wrongHostInvitation = readInvitation(wrongHostEmail);
    if (!wrongHostInvitation)
      throw new Error("Wrong-host test invitation was not delivered.");
    const wrongHostToken = new URL(
      wrongHostInvitation.inviteUrl,
    ).searchParams.get("token");
    if (!wrongHostToken) throw new Error("Wrong-host test link was malformed.");

    await page.getByRole("button", { name: "خروج امن" }).click();
    await page.waitForURL("**/login");
    expect(
      await page.evaluate(
        async () => (await fetch("/api/tenant/roles")).status,
      ),
    ).toBe(401);
    await page.goto(`http://localhost:${e2ePort}/platform`);

    const authenticatedStatus = await page.evaluate(
      async () => (await fetch("/api/platform/tenants")).status,
    );
    expect(authenticatedStatus).toBe(200);

    await page.goto(`http://localhost:${e2ePort}/platform/tenants/new`);
    const secondSlug = `e2e-${randomUUID().slice(0, 8)}`;
    saveTenantState(null, secondSlug);
    await page.getByLabel("نام مجموعه").fill("EventOS E2E Tenant B");
    await page
      .getByLabel("نام ثبتی (اختیاری)")
      .fill("EventOS E2E Tenant B Inc.");
    await page.getByLabel("شناسه / زیردامنه").fill(secondSlug);
    await page.getByLabel("نام مدیر اصلی").fill("Tenant B Owner");
    const secondOwnerEmail = `owner-${randomUUID()}@example.test`;
    await page.getByLabel("ایمیل مدیر اصلی").fill(secondOwnerEmail);
    await expect(page.getByText("این آدرس آزاد است ✓")).toBeVisible();
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByLabel("لوگو (اختیاری)").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByRole("button", { name: "ایجاد مجموعه" }).click();
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]{36}$/, {
      timeout: 90_000,
    });
    const secondTenantId = page.url().split("/").at(-1) ?? null;
    if (!secondTenantId)
      throw new Error("Tenant B page did not contain a tenant ID.");
    saveTenantState(secondTenantId, secondSlug);
    await expect(provisioningStatus).toHaveText("آماده استفاده", {
      timeout: 45_000,
    });
    expect(
      await page.evaluate(async (id) => {
        const response = await fetch(`/api/platform/tenants/${id}/features`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            overrides: [{ key: "courses", enabled: true }],
          }),
        });
        return response.status;
      }, secondTenantId),
    ).toBe(200);

    const secondInvitation = readInvitation(secondOwnerEmail);
    if (!secondInvitation)
      throw new Error("Tenant B owner invitation was not delivered.");
    const secondToken = new URL(secondInvitation.inviteUrl).searchParams.get(
      "token",
    );
    if (!secondToken) throw new Error("Tenant B owner link was malformed.");

    const secondOrigin = `http://${secondSlug}.localhost:${e2ePort}`;
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(secondOrigin);
    const logo = secondPage.locator(".public-logo img");
    await expect(logo).toBeVisible();
    expect(await logo.getAttribute("src")).toMatch(
      /^\/api\/media\/[0-9a-f-]{36}$/,
    );
    await secondPage.goto(
      `${secondOrigin}/accept-invitation?token=${encodeURIComponent(secondToken)}`,
    );
    await secondPage
      .getByLabel("گذرواژهٔ تازه")
      .fill("second owner e2e password");
    await secondPage
      .getByLabel("تکرار گذرواژه")
      .fill("second owner e2e password");
    const secondActivation = secondPage.waitForResponse(
      (response) =>
        response.url().includes("/api/tenant/invitations/accept") &&
        response.request().method() === "POST",
    );
    await secondPage.getByRole("button", { name: "فعال‌سازی حساب" }).click();
    expect((await secondActivation).status()).toBe(200);
    await expect(secondPage.getByRole("status")).toContainText(
      "حساب شما فعال شد",
    );
    await secondPage.goto(`${secondOrigin}/login`);
    await secondPage
      .getByLabel("ایمیل", { exact: true })
      .fill(secondOwnerEmail);
    await secondPage
      .getByLabel("گذرواژه", { exact: true })
      .fill("second owner e2e password");
    await secondPage.getByRole("button", { name: "ورود امن" }).click();
    await secondPage.waitForURL("**/dashboard");
    expect(
      await secondPage.evaluate(
        async (id) => (await fetch(`/api/tenant/programs/${id}`)).status,
        phase3ProgramId,
      ),
    ).toBe(404);
    expect(
      (
        await request.get(`http://127.0.0.1:${e2ePort}${firstCoverUrl}`, {
          headers: { host: `${secondSlug}.localhost:${e2ePort}` },
        })
      ).status(),
    ).toBe(404);
    await secondContext.close();
    const crossTenantSession = await request.get(
      `http://127.0.0.1:${e2ePort}/api/tenant/identity/staff`,
      {
        headers: {
          host: `${secondSlug}.localhost:${e2ePort}`,
          cookie: `${ownerCookie.name}=${ownerCookie.value}`,
        },
      },
    );
    expect(crossTenantSession.status()).toBe(401);
    const wrongHostAcceptance = await request.post(
      `http://127.0.0.1:${e2ePort}/api/tenant/invitations/accept`,
      {
        data: {
          token: wrongHostToken,
          password: "wrong host attempt password",
        },
        headers: {
          host: `${secondSlug}.localhost:${e2ePort}`,
          origin: secondOrigin,
        },
      },
    );
    expect(wrongHostAcceptance.status()).toBe(400);

    await page.getByRole("button", { name: "خروج امن" }).click();
    await page.waitForURL("**/sign-in");
    const revokedStatus = await page.evaluate(
      async () => (await fetch("/api/platform/tenants")).status,
    );
    expect(revokedStatus).toBe(401);
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    const stops = await Promise.allSettled([
      stopWorker(failWorker),
      ...(retryWorker ? [stopWorker(retryWorker)] : []),
    ]);
    if (tenantId) saveTenantState(tenantId, null);
    const failures = stops.filter((result) => result.status === "rejected");
    reportCleanupFailures(
      "Provisioning worker cleanup failed",
      failures,
      originalError,
    );
  }
}

test.describe("platform and tenant journey", () => {
  test.describe.configure({ mode: "serial" });
  let sharedContext: BrowserContext;
  let anonymousRequest: APIRequestContext;
  let journey: AsyncGenerator<string, void, unknown>;
  let journeyError: unknown;

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext();
    anonymousRequest = await apiRequest.newContext({
      baseURL: `http://localhost:${e2ePort}`,
    });
    const page = await sharedContext.newPage();
    journey = tenantJourney({ page, request: anonymousRequest, browser });
  });

  test.afterAll(async () => {
    let finalizationError: unknown;
    try {
      if (journey) await journey.return();
    } catch (error) {
      finalizationError = error;
    }
    const closed = await Promise.allSettled([
      ...(sharedContext ? [sharedContext.close()] : []),
      ...(anonymousRequest ? [anonymousRequest.dispose()] : []),
    ]);
    const failures = closed
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (finalizationError) failures.push(finalizationError);
    reportCleanupFailures("Journey cleanup failed", failures, journeyError);
  });

  const phases = [
    "provisioning and tenant branding",
    "tenant RBAC and invited identities",
    "program creation and public enrollment",
    "payment browser flows",
    "pilot authentication flows",
    "pilot Google new participant",
    "attendance and certificates",
    "tenant isolation and session revocation",
  ];
  const focusAttendance = process.env.EVENTOS_E2E_FOCUS_ATTENDANCE === "true";
  for (const [index, phase] of phases.entries()) {
    if (focusAttendance && phase !== "attendance and certificates") continue;
    test(phase, async () => {
      test.setTimeout(
        focusAttendance
          ? 600_000
          : phase === "pilot Google new participant"
            ? 120_000
            : 240_000,
      );
      try {
        const start = focusAttendance ? 0 : index;
        for (let phaseIndex = start; phaseIndex <= index; phaseIndex++) {
          const result = await journey.next();
          expect(result.done).toBe(phaseIndex === phases.length - 1);
          if (!result.done) expect(result.value).toBe(phases[phaseIndex]);
        }
      } catch (error) {
        journeyError = error;
        throw error;
      }
    });
  }
});
