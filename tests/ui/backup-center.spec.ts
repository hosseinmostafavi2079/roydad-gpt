import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("backup center: authorization, safe requests, details and responsive RTL", async ({
  page,
}) => {
  await page.goto("/platform/backups");
  await expect(page).toHaveURL(/\/sign-in/);
  const credentials = JSON.parse(
    readFileSync(".demo-credentials.local", "utf8"),
  );
  const login = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      email: credentials.platform.email,
      password: credentials.platform.password,
    },
  });
  expect(login.ok()).toBe(true);
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const job = {
    id: "22222222-2222-4222-8222-222222222222",
    scope: "FULL_PLATFORM",
    tenantId: null,
    state: "SUCCEEDED",
    triggerType: "MANUAL",
    requestId: "ui-request",
    checksumVerified: true,
    sizeBytes: "1048576",
    backupKey: "hidden-host-key",
    createdAt: "2026-10-07T01:00:00Z",
    startedAt: "2026-10-07T01:00:00Z",
    completedAt: "2026-10-07T02:00:00Z",
    updatedAt: "2026-10-07T02:00:00Z",
    errorCode: null,
    errorMessage: null,
    deleteRequest: { state: null as "QUEUED" | "RUNNING" | "FAILED" | null },
    canDelete: true,
    deleteProtected: false,
  };
  let jobs = [
    job,
    {
      ...job,
      id: "queued-fresh",
      requestId: "queued-fresh",
      state: "QUEUED",
      createdAt: new Date().toISOString(),
    },
    {
      ...job,
      id: "queued-delayed",
      requestId: "queued-delayed",
      state: "QUEUED",
      createdAt: new Date(Date.now() - 180_000).toISOString(),
    },
    { ...job, id: "running", requestId: "running", state: "RUNNING" },
    { ...job, id: "verifying", requestId: "verifying", state: "VERIFYING" },
    { ...job, id: "pruned", requestId: "pruned", state: "PRUNED" },
  ];
  let policy = {
    id: "policy",
    scope: "FULL_PLATFORM",
    enabled: false,
    frequency: "DAILY",
    executionTime: "02:00",
    weekday: null as number | null,
    timezone: "Asia/Tehran",
    retentionCount: 7,
    nextRunAt: null,
    lastRunAt: null,
  };
  const requests: unknown[] = [];
  let deletionRequests = 0;
  let rejectDeletion = true;
  await page.route("**/api/platform/tenants?*", (route) =>
    route.fulfill({
      json: {
        data: {
          items: [{ id: tenantId, displayName: "سازمان آزمایشی" }],
          pageCount: 1,
        },
      },
    }),
  );
  await page.route("**/api/platform/backups**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/policy")) {
      if (request.method() === "PATCH")
        policy = { ...policy, ...request.postDataJSON() };
      await route.fulfill({ json: { data: policy } });
    } else if (new URL(request.url()).pathname.endsWith("/delete")) {
      expect(request.postDataJSON()).toEqual({});
      if (rejectDeletion) {
        rejectDeletion = false;
        await route.fulfill({
          status: 409,
          json: {
            error: {
              code: "CONFLICT",
              message: "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
            },
          },
        });
        return;
      }
      deletionRequests++;
      const queued = {
        ...job,
        canDelete: false,
        deleteRequest: { state: "QUEUED" as const },
      };
      jobs = jobs.map((item) => (item.id === queued.id ? queued : item));
      await route.fulfill({ json: { data: queued } });
    } else if (request.method() === "POST") {
      const body = request.postDataJSON();
      requests.push(body);
      const queued = { ...job, ...body, state: "QUEUED", canDelete: false };
      jobs = [queued];
      await route.fulfill({ json: { data: queued } });
    } else
      await route.fulfill({
        json: {
          data: new URL(request.url()).searchParams.has("limit")
            ? jobs
            : jobs[0],
        },
      });
  });
  await page.goto("/platform/backups");
  await expect(
    page.getByRole("heading", { name: "پشتیبان‌گیری", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "سازمان‌ها", exact: true }).first(),
  ).toBeAttached();
  await expect(
    page.getByRole("button", { name: "تهیه بکاپ سازمان", exact: true }),
  ).toBeDisabled();
  mkdirSync(".local/backup-center-screenshots", { recursive: true });
  await expect(
    page.getByText("بکاپ با موفقیت تکمیل شد.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("در انتظار شروع سرویس بکاپ", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText("این درخواست هنوز توسط سرویس اجرای بکاپ دریافت نشده است.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("در حال تهیه نسخه پشتیبان...", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("در حال بررسی فایل‌ها و صحت Checksum...", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".backup-job-status").getByText("حذف شده", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".backup-job .backup-spinner")).toHaveCount(4);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      page.getByRole("heading", { name: "تاریخچه بکاپ‌ها" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/backup-center-screenshots/${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "حذف نسخه", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "حذف نسخه پشتیبان" }),
  ).toContainText("اطلاعات سابقه برای گزارش‌گیری باقی می‌ماند.");
  expect(deletionRequests).toBe(0);
  await page.getByRole("button", { name: "درخواست حذف", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "حذف نسخه پشتیبان" }),
  ).toContainText("حداقل یک نسخه پشتیبان موفق باید باقی بماند.");
  expect(deletionRequests).toBe(0);
  await page.getByRole("button", { name: "درخواست حذف", exact: true }).click();
  await expect(page.getByText("در صف حذف", { exact: true })).toBeVisible();
  expect(deletionRequests).toBe(1);
  await page
    .getByRole("button", { name: "تهیه بکاپ کامل", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "تهیه بکاپ کامل پلتفرم" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(requests).toHaveLength(0);
  await page
    .getByRole("button", { name: "تهیه بکاپ کامل", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ثبت درخواست بکاپ", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "درخواست بکاپ ثبت شد" }),
  ).toBeVisible();
  expect(requests[0]).toEqual({ scope: "FULL_PLATFORM" });
  await page.getByLabel("سازمان", { exact: true }).selectOption(tenantId);
  await page
    .getByRole("button", { name: "تهیه بکاپ سازمان", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ثبت درخواست بکاپ", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ scope: "TENANT", tenantId });
  await page.getByLabel("تکرار", { exact: true }).selectOption("WEEKLY");
  await page.getByLabel("روز هفته", { exact: true }).selectOption("3");
  await page.getByLabel("تعداد نسخه‌های نگهداری", { exact: true }).fill("0");
  expect(
    await page
      .getByLabel("تعداد نسخه‌های نگهداری", { exact: true })
      .evaluate((element: HTMLInputElement) => element.validity.valid),
  ).toBe(false);
  await page.getByLabel("تعداد نسخه‌های نگهداری", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: "ذخیره تنظیمات", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "تنظیمات ذخیره شد" }),
  ).toBeVisible();
  expect(policy.weekday).toBe(3);
  expect(requests).toHaveLength(2);
  await page
    .getByRole("button", { name: "جزئیات بکاپ ui-request", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "جزئیات بکاپ" })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "جزئیات بکاپ" }),
  ).not.toContainText("hidden-host-key");
  await page.keyboard.press("Escape");
  expect(
    await page.getByRole("button", { name: /بازیابی|دانلود/ }).count(),
  ).toBe(0);
});
