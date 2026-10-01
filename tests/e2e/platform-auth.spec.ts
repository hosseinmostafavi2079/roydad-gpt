import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { currentTotp } from "../helpers/totp";

test("platform admin password login respects the MFA setting", async ({
  page,
}) => {
  const email = process.env.EVENTOS_E2E_ADMIN_EMAIL;
  const password = process.env.EVENTOS_E2E_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("E2E admin credentials are missing.");
  if (process.env.PLATFORM_REQUIRE_MFA !== "true") {
    const client = new Client({
      connectionString: process.env.CONTROL_DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query(
        `UPDATE platform_auth_users SET "twoFactorEnabled"=true WHERE email=$1`,
        [email],
      );
    } finally {
      await client.end();
    }
  }
  await page.goto("/sign-in");
  await page.getByLabel("ایمیل سازمانی").fill(email);
  await page.getByLabel("گذرواژه", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ورود امن به پلتفرم" }).click();
  if (process.env.PLATFORM_REQUIRE_MFA === "true") {
    await page.waitForURL("**/platform/security/mfa");
    const enableResponse = page.waitForResponse((response) =>
      response.url().includes("/api/auth/two-factor/enable"),
    );
    await page.getByLabel("گذرواژهٔ فعلی").fill(password);
    await page
      .getByRole("button", { name: "راه‌اندازی احراز هویت دو‌مرحله‌ای" })
      .click();
    const setup = (await (await enableResponse).json()) as { totpURI: string };
    const secret = new URL(setup.totpURI).searchParams.get("secret");
    if (!secret) throw new Error("TOTP enrollment returned no secret.");
    const enrollmentCode = currentTotp(secret);
    await page.getByLabel("کد شش‌رقمی برنامه").fill(enrollmentCode);
    await page.getByRole("button", { name: "فعال‌سازی و ورود به پنل" }).click();
    await page.waitForURL("**/platform");
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
  } else {
    await expect(page.getByLabel("کد برنامهٔ احراز هویت")).toHaveCount(0);
  }
  await page.waitForURL("**/platform");
  await expect(
    page.getByRole("heading", { name: "به پنل EventOS خوش آمدید" }),
  ).toBeVisible();
});
