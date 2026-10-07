import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("create, one-time activation, existing password sign-in and responsive admin UI", async ({
  page,
  browser,
}) => {
  const origin = "http://localhost:3001";
  await page.goto("/platform/admins");
  await expect(page).toHaveURL(/\/sign-in/);
  const credentials = JSON.parse(
    readFileSync(".demo-credentials.local", "utf8"),
  );
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: {
          email: credentials.platform.email,
          password: credentials.platform.password,
        },
      })
    ).ok(),
  ).toBe(true);
  // Revoke only pending identities left by this local test's fixture namespace.
  const previous = (
    await (await page.request.get("/api/platform/admins")).json()
  ).data.items;
  for (const item of previous) {
    if (
      item.email.startsWith("ui-admin-") &&
      item.email.endsWith("@example.test") &&
      item.displayName === "مدیر آزمایشی جدید" &&
      item.status === "PENDING_ACTIVATION"
    ) {
      expect(
        (
          await page.request.post(`/api/platform/admins/${item.id}/revoke`, {
            headers: { Origin: origin },
            data: {},
          })
        ).ok(),
      ).toBe(true);
    }
  }
  await page.goto("/platform/admins");
  await expect(
    page.getByRole("heading", { name: "مدیران پلتفرم", exact: true }),
  ).toBeVisible();
  const email = `ui-admin-${randomUUID()}@example.test`,
    name = "مدیر آزمایشی جدید",
    password = `Personal secure admin password ${randomUUID()}`;
  let id: string | undefined;
  const activationContext = await browser.newContext();
  try {
    await page
      .getByRole("button", { name: "افزودن مدیر جدید", exact: true })
      .click();
    await page.getByRole("dialog").getByLabel("نام مدیر").fill(name);
    await page
      .getByRole("dialog")
      .getByLabel("ایمیل", { exact: true })
      .fill(email);
    await page
      .getByRole("button", { name: "ایجاد حساب در انتظار فعال‌سازی" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByText("کد فعال‌سازی فقط همین یک بار نمایش داده می‌شود."),
    ).toBeVisible();
    const code = await panel.locator("output").textContent();
    if (!code) throw new Error("One-time panel missing");
    const listing = await page.request.get("/api/platform/admins");
    const data = (await listing.json()).data;
    id = data.items.find((item: { email: string }) => item.email === email)?.id;
    expect(Boolean(id)).toBe(true);
    await panel
      .getByRole("button", { name: "بستن", exact: true })
      .last()
      .click();
    expect(JSON.stringify(data).includes(code)).toBe(false);
    expect(
      await page.evaluate(
        (value) =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
            value,
          ),
        code,
      ),
    ).toBe(false);
    const activation = await activationContext.newPage();
    await activation.setViewportSize({ width: 390, height: 900 });
    const denied = await activation.goto(
      "http://demo.localhost:3001/platform-activation",
    );
    expect(denied?.status()).toBe(404);
    await activation.goto(`${origin}/platform-activation`);
    await activation.getByLabel("ایمیل", { exact: true }).fill(email);
    await activation.getByLabel("کد فعال‌سازی", { exact: true }).fill(code);
    await activation.getByLabel("رمز عبور جدید").fill(password);
    await activation.getByLabel("تکرار رمز عبور").fill(password);
    expect(
      await activation.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await activation
      .getByRole("button", { name: "فعال‌سازی حساب", exact: true })
      .click();
    await expect(
      activation.getByText("حساب مدیر فعال شد. اکنون می‌توانید وارد شوید."),
    ).toBeVisible();
    expect(
      (await activation.request.get(`${origin}/api/platform/admins`)).status(),
    ).toBe(401);
    const signup = await activation.request.post(
      `${origin}/api/auth/sign-up/email`,
      {
        headers: { Origin: origin },
        data: {
          name: "No Public Signup",
          email: `signup-${randomUUID()}@example.test`,
          password,
        },
      },
    );
    expect(signup.status()).toBeGreaterThanOrEqual(400);
    await activation.getByRole("link", { name: "ورود به پلتفرم" }).click();
    await activation.getByLabel("ایمیل سازمانی").fill(email);
    await activation.getByLabel("گذرواژه", { exact: true }).fill(password);
    await activation
      .getByRole("button", { name: "ورود امن به پلتفرم" })
      .click();
    await expect(activation).toHaveURL(`${origin}/platform`);
    await page.reload();
    mkdirSync(".local/platform-admins-screenshots", { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(
        page
          .locator("article")
          .filter({ hasText: email })
          .getByRole("heading", { name: name, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.local/platform-admins-screenshots/${width}.png`,
        fullPage: true,
      });
    }
    const card = page.locator("article").filter({ hasText: email });
    await card.getByRole("button", { name: "خروج از همه دستگاه‌ها" }).click();
    const sessionRevocation = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/platform/admins/${id}/sessions/revoke`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "تأیید", exact: true })
      .click();
    expect((await sessionRevocation).ok()).toBe(true);
    await expect
      .poll(async () =>
        (
          await activation.request.get(`${origin}/api/platform/admins`)
        ).status(),
      )
      .toBe(401);
  } finally {
    // Failed-test DOM snapshots must not retain the one-time display panel.
    await page.evaluate(() =>
      document.querySelectorAll("output").forEach((value) => {
        value.textContent = "";
      }),
    );
    if (id)
      expect(
        (
          await page.request.post(`/api/platform/admins/${id}/revoke`, {
            headers: { Origin: origin },
            data: {},
          })
        ).ok(),
      ).toBe(true);
    await activationContext.close();
  }
});
