import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("diagnostics: authorization, filters, safe detail/export and responsive RTL", async ({
  page,
}) => {
  await page.goto("/platform/diagnostics");
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
  const incident = {
    id: "11111111-1111-4111-8111-111111111111",
    incidentRef: "INC-20261007-11111111111141118111111111111111",
    status: "OPEN",
    severity: "CRITICAL",
    component: "BACKUP_SYSTEM",
    eventCode: "BACKUP_FAILED",
    tenantId: "22222222-2222-4222-8222-222222222222",
    summary: "تهیه بکاپ ناموفق بود.",
    probableCause: "اجرا یا بررسی بکاپ تکمیل نشده است.",
    firstSeenAt: "2026-10-07T01:00:00Z",
    lastSeenAt: "2026-10-07T02:00:00Z",
    recoveredAt: null,
    occurrenceCount: "2",
    latestRequestId: "33333333-3333-4333-8333-333333333333",
    troubleshooting: ["فضای ذخیره‌سازی", "صحت آرشیو و checksum"],
  };
  const requests: URL[] = [];
  let tenantRequests = 0;
  await page.route("**/api/platform/tenants?*", (route) => {
    tenantRequests++;
    return route.fulfill({
      json: {
        data: {
          items: [{ id: incident.tenantId, displayName: "سازمان آزمایشی" }],
        },
      },
    });
  });
  await page.route("**/api/platform/diagnostics/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.endsWith("/export"))
      return route.fulfill({
        contentType: "application/json",
        headers: {
          "Content-Disposition": `attachment; filename="eventos-incident-${incident.incidentRef}.json"`,
        },
        body: JSON.stringify({ data: { incident } }),
      });
    const data = url.pathname.endsWith("/summary")
      ? {
          components: [
            { component: "APPLICATION", status: "HEALTHY" },
            { component: "CONTROL_DATABASE", status: "HEALTHY" },
            { component: "MAIN_WORKER", status: "UNKNOWN" },
            { component: "BACKUP_RUNNER", status: "DEGRADED" },
            { component: "BACKUP_SYSTEM", status: "UNAVAILABLE" },
            { component: "TENANT_PROVISIONING", status: "HEALTHY" },
          ],
        }
      : url.pathname.endsWith("/events")
        ? [
            {
              id: "44444444-4444-4444-8444-444444444444",
              severity: "ERROR",
              component: incident.component,
              eventCode: incident.eventCode,
              message: "تهیه بکاپ ناموفق بود.",
              tenantId: incident.tenantId,
              requestId: incident.latestRequestId,
              incidentId: incident.id,
              occurredAt: incident.lastSeenAt,
              metadata: {},
              stack: "hidden-stack",
              token: "hidden-token",
            },
          ]
        : url.pathname.endsWith("/incidents")
          ? [incident]
          : incident;
    return route.fulfill({ json: { data } });
  });
  await page.goto("/platform/diagnostics");
  await expect(
    page.getByRole("heading", { name: "وضعیت کلی سیستم" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "پشتیبان‌گیری", exact: true }),
  ).toBeAttached();
  await page.locator("#diag-status").selectOption("RECOVERED");
  await page.getByRole("button", { name: "اعمال فیلترها" }).click();
  await expect
    .poll(() =>
      requests.some((url) => url.searchParams.get("status") === "RECOVERED"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "پاک کردن فیلترها" }).click();
  await expect(page.locator("#diag-status")).toHaveValue("");
  mkdirSync(".local/diagnostics-center-screenshots", { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/diagnostics-center-screenshots/${width}.png`,
      fullPage: true,
    });
    const trigger = page.getByRole("button", {
      name: `جزئیات ${incident.incidentRef}`,
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(incident.probableCause)).toBeVisible();
    await expect(dialog.getByText("صحت آرشیو و checksum")).toBeVisible();
    await expect(dialog).not.toContainText(/hidden-stack|hidden-token/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `.local/diagnostics-center-screenshots/detail-${width}.png`,
      });
    if (width === 1440) {
      const download = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "دریافت گزارش عیب‌یابی" })
        .click();
      expect((await download).suggestedFilename()).toBe(
        `eventos-incident-${incident.incidentRef}.json`,
      );
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  // Next development Strict Mode replays the mount effect once; never per row/filter.
  expect(tenantRequests).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "بروزرسانی", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "بروزرسانی", exact: true }),
  ).toBeEnabled();
  expect(
    requests.every((url) =>
      url.pathname.startsWith("/api/platform/diagnostics/"),
    ),
  ).toBe(true);
});
