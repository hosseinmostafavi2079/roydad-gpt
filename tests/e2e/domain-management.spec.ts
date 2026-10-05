import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const tenantId = randomUUID();
const slug = `domains-${tenantId.slice(0, 8)}`;
const dnsFile = process.env.EVENTOS_E2E_DOMAIN_DNS_FILE;
const screenshots = path.join(process.cwd(), "test-results", "domain-ui");
test.beforeAll(async () => {
  if (
    !dnsFile ||
    !path
      .resolve(dnsFile)
      .startsWith(`${path.resolve(os.tmpdir())}${path.sep}eventos-e2e-domain-`)
  )
    throw new Error("Domain browser test requires isolated DNS fixture file");
  writeFileSync(dnsFile, "{}", { mode: 0o600 });
  const client = new Client({
    connectionString: process.env.CONTROL_DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO tenants(id,slug,legal_name,display_name,status,plan_id,created_by) SELECT $1,$2,'Domain UI fixture','مجموعه نمایش دامنه','PROVISIONING',id,'e2e-domains' FROM plans WHERE code='foundation'",
      [tenantId, slug],
    );
    await client.query(
      "INSERT INTO tenant_database_registry(tenant_id,database_name) VALUES($1,$2)",
      [tenantId, `eventos_t_${tenantId.replaceAll("-", "")}`],
    );
    await client.query(
      "INSERT INTO tenant_branding(tenant_id,brand_name,updated_by) VALUES($1,'مجموعه نمایش دامنه','e2e-domains')",
      [tenantId],
    );
    await client.query(
      "INSERT INTO tenant_features(tenant_id,feature_key,enabled,updated_by) VALUES($1,'custom_domain',true,'e2e-domains')",
      [tenantId],
    );
    await client.query(
      "INSERT INTO tenant_limits(tenant_id,limit_key,limit_value,updated_by) VALUES($1,'max_custom_domains',5,'e2e-domains')",
      [tenantId],
    );
    await client.query(
      "INSERT INTO tenant_domains(tenant_id,hostname,domain_type,is_primary,verified_at,created_by) VALUES($1,$2,'PLATFORM_SUBDOMAIN',true,now(),'e2e-domains')",
      [tenantId, `${slug}.localhost`],
    );
  } finally {
    await client.end();
  }
  mkdirSync(screenshots, { recursive: true });
});
test.afterAll(async () => {
  const client = new Client({
    connectionString: process.env.CONTROL_DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query(
      "DELETE FROM tenant_database_registry WHERE tenant_id=$1",
      [tenantId],
    );
    await client.query("DELETE FROM tenants WHERE id=$1", [tenantId]);
  } finally {
    await client.end();
    if (dnsFile && existsSync(dnsFile)) unlinkSync(dnsFile);
  }
});
test("domain management: add, verify, primary, delete, mobile and wizard handoff", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/sign-in");
  await page
    .getByLabel("ایمیل سازمانی")
    .fill(process.env.EVENTOS_E2E_ADMIN_EMAIL ?? "");
  await page
    .getByLabel("گذرواژه", { exact: true })
    .fill(process.env.EVENTOS_E2E_ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "ورود امن به پلتفرم" }).click();
  await page.waitForURL("**/platform");
  await page.goto(`/platform/tenants/${tenantId}`);
  const section = page.getByRole("region", { name: "دامنه‌های مجموعه" });
  await expect(section).toBeVisible();
  await section.screenshot({
    path: path.join(screenshots, "1440-domain-section.png"),
  });
  await section
    .getByRole("button", { name: "افزودن دامنه", exact: true })
    .click();
  const add = page.getByRole("dialog", { name: "افزودن دامنه", exact: true });
  await expect(add).toBeVisible();
  await add.screenshot({ path: path.join(screenshots, "1440-add-domain.png") });
  const hostname = `event-${tenantId.slice(0, 8)}.domain-ui.example`;
  await add.getByLabel("دامنه مجموعه").fill(hostname);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/tenants/${tenantId}/domains`) &&
      response.request().method() === "POST",
  );
  await add.getByRole("button", { name: "ثبت دامنه", exact: true }).click();
  const result = (await (await created).json()) as {
    data: {
      domain: { id: string };
      verification: { recordName: string; recordValue: string };
    };
  };
  const dns = page.getByRole("dialog", {
    name: "تایید مالکیت دامنه",
    exact: true,
  });
  await expect(dns).toBeVisible();
  await expect(
    dns.getByText(result.data.verification.recordName, { exact: true }),
  ).toBeVisible();
  await dns.screenshot({
    path: path.join(screenshots, "1440-dns-instructions.png"),
  });
  await dns.getByRole("button", { name: "کپی نام", exact: true }).click();
  await expect(dns.getByRole("status")).toHaveText("کپی شد");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    result.data.verification.recordName,
  );
  await dns
    .getByRole("button", { name: "بررسی تایید دامنه", exact: true })
    .click();
  await expect(dns.getByRole("alert")).toContainText("خطا در بررسی DNS");
  await page.setViewportSize({ width: 390, height: 844 });
  await dns.screenshot({
    path: path.join(screenshots, "390-dns-instructions.png"),
  });
  expect(await dns.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await dns.getByRole("button", { name: "بستن", exact: true }).click();
  const card = section.getByRole("article", { name: hostname });
  await expect(
    card.getByText("در انتظار تایید", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "اصلی کردن", exact: true }),
  ).toHaveCount(0);
  await section.screenshot({
    path: path.join(screenshots, "390-domain-section.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (!dnsFile) throw new Error("DNS fixture missing");
  writeFileSync(
    dnsFile,
    JSON.stringify({
      [result.data.verification.recordName]:
        result.data.verification.recordValue,
    }),
    { mode: 0o600 },
  );
  await card
    .getByRole("button", { name: "بررسی تایید دامنه", exact: true })
    .click();
  await expect(card.getByText("تایید شده", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await card.getByRole("button", { name: "اصلی کردن", exact: true }).click();
  const primary = page.getByRole("dialog", {
    name: "تغییر دامنه اصلی",
    exact: true,
  });
  await expect(primary).toBeVisible();
  await primary.screenshot({
    path: path.join(screenshots, "1440-primary-confirmation.png"),
  });
  await primary
    .getByRole("button", { name: "تغییر دامنه اصلی", exact: true })
    .click();
  await expect(card.getByText("دامنه اصلی", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "اصلی کردن", exact: true }),
  ).toHaveCount(0);
  await section.screenshot({
    path: path.join(screenshots, "1440-verified-primary.png"),
  });
  await expect(page.locator(".page-description")).toContainText(hostname);
  const old = section.getByRole("article", { name: `${slug}.localhost` });
  await old.getByLabel(`گزینه‌های ${slug}.localhost`).click();
  await old.getByRole("button", { name: "حذف دامنه", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "حذف دامنه", exact: true });
  await expect(remove).toBeVisible();
  await remove.getByRole("button", { name: "حذف دامنه", exact: true }).click();
  await expect(old).toHaveCount(0);
  // Exercise the same pending hostname handoff used by the optional wizard field.
  await page.evaluate(
    ({ id, host }) =>
      sessionStorage.setItem(
        "eventos-domain-draft",
        JSON.stringify({ tenantId: id, hostname: host }),
      ),
    { id: tenantId, host: `wizard-${tenantId.slice(0, 8)}.domain-ui.example` },
  );
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "تایید مالکیت دامنه", exact: true }),
  ).toBeVisible();
});
