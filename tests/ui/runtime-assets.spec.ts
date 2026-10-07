import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

test("built core pages render with third-party requests blocked and local fonts", async ({
  page,
}) => {
  const unexpected: string[] = [];
  const fonts: string[] = [];
  const activeOrigin = "http://localhost:3001";
  async function watch(target: Page, origin: string) {
    await target.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (["data:", "blob:"].includes(url.protocol)) return route.continue();
      if (url.origin !== origin) {
        // Fail for every unexpected request in this fixture, not merely link destinations.
        unexpected.push(`${request.resourceType()}: ${url.origin}`);
        return route.abort();
      }
      if (request.resourceType() === "font") fonts.push(url.href);
      return route.continue();
    });
  }
  await watch(page, activeOrigin);
  await page.goto("/sign-in");
  await expect(page.locator("input[type=password]")).toBeVisible();
  const credentials = JSON.parse(
    readFileSync(".demo-credentials.local", "utf8"),
  );
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: activeOrigin },
        data: {
          email: credentials.platform.email,
          password: credentials.platform.password,
        },
      })
    ).ok(),
  ).toBe(true);
  for (const [route, heading] of [
    ["/platform/backups", "پشتیبان‌گیری"],
    ["/platform/diagnostics", "عیب‌یابی و سلامت سیستم"],
  ] as const) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  }
  // A separate page keeps pending admin requests tied to their original origin.
  const publicPage = await page.context().newPage();
  await watch(publicPage, "http://demo.localhost:3001");
  await publicPage.goto("http://demo.localhost:3001");
  await expect(publicPage.locator(".public-logo")).toBeVisible();
  await publicPage.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(
    await publicPage.evaluate(() =>
      document.fonts.check("400 16px Vazirmatn", "سلام"),
    ),
  ).toBe(true);
  expect(fonts.length).toBeGreaterThan(0);
  expect(
    fonts.every((url) =>
      new URL(url).pathname.startsWith("/_next/static/media/"),
    ),
  ).toBe(true);
  expect(unexpected).toEqual([]);
});
