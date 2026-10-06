import { expect, test } from "@playwright/test";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { Pool } from "pg";
import { spawnSync } from "node:child_process";

test("existing program local cover upload, reload, range, replace and delete", async ({
  page,
}) => {
  const storedFileExists = (file: string) =>
    process.env.EVENTOS_DEVELOPMENT_STORAGE === "docker"
      ? spawnSync(
          "docker",
          [
            "compose",
            "exec",
            "-T",
            "app",
            "node",
            "-e",
            "process.exit(require('node:fs').existsSync(process.argv[1])?0:1)",
            file,
          ],
          { encoding: "utf8", windowsHide: true },
        ).status === 0
      : existsSync(file);
  const mediaRoot =
    process.env.EVENTOS_DEVELOPMENT_STORAGE === "docker"
      ? "/app/data/media"
      : undefined;
  const mediaPath = (...parts: string[]) =>
    mediaRoot ? path.posix.join(...parts) : path.join(...parts);
  const credentials = JSON.parse(
    readFileSync(".demo-credentials.local", "utf8"),
  );
  const env = parseEnv(readFileSync(".env", "utf8"));
  await page.goto("/login");
  await page.getByRole("button", { name: "نام کاربری و رمز عبور" }).click();
  await page
    .getByLabel("نام کاربری", { exact: true })
    .fill(credentials.owner.username);
  await page
    .getByLabel("رمز عبور", { exact: true })
    .fill(credentials.owner.password);
  await page.getByRole("button", { name: "ورود", exact: true }).last().click();
  await page.waitForURL("**/dashboard");
  if (process.env.EVENTOS_MEDIA_ACCEPTANCE_STAGE === "verify") {
    const saved = JSON.parse(
      readFileSync(".local/media-persistence.json", "utf8"),
    );
    expect(storedFileExists(saved.file)).toBe(true);
    const response = await page.request.get(saved.url);
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(
      readFileSync("tests/fixtures/program-cover.png"),
    );
    await page.goto("/programs");
    await expect(page.locator(`img[src="${saved.url}"]`).first()).toBeVisible();
    return;
  }
  await page.goto("/programs");
  await page
    .getByRole("row")
    .filter({ hasText: "contract-law-webinar" })
    .getByRole("button", { name: "ویرایش", exact: true })
    .click();
  await page.getByRole("button", { name: "رسانه", exact: true }).click();
  const uploader = page
    .locator(".media-uploader")
    .filter({ hasText: "تصویر شاخص / کاور" });
  const upload = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/tenant/media") &&
        r.request().method() === "POST",
    );
    await uploader
      .locator('input[type="file"]')
      .setInputFiles("tests/fixtures/program-cover.png");
    const result = await response;
    expect(result.status()).toBe(200);
    const body = await result.json();
    return body.data as { id: string; url: string; sizeBytes: number };
  };
  const control = new Pool({ connectionString: env.CONTROL_DATABASE_URL });
  let tenant: Pool | undefined;
  try {
    const registry = await control.query(
      "SELECT tenant.id,registry.database_name FROM tenants tenant JOIN tenant_database_registry registry ON registry.tenant_id=tenant.id WHERE tenant.slug='demo'",
    );
    const url = new URL(env.TENANT_RUNTIME_DATABASE_URL ?? "");
    url.pathname = `/${registry.rows[0].database_name}`;
    tenant = new Pool({ connectionString: url.href });
    const keyFor = async (id: string) =>
      String(
        (
          await tenant?.query(
            "SELECT object_key FROM tenant_media WHERE tenant_id=$1 AND id=$2",
            [registry.rows[0].id, id],
          )
        )?.rows[0]?.object_key,
      );
    const first = await upload();
    const key = await keyFor(first.id);
    const file = mediaPath(
      mediaRoot ?? env.MEDIA_LOCAL_ROOT ?? "",
      ...key.split("/"),
    );
    expect(storedFileExists(file)).toBe(true);
    await expect(uploader.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        uploader
          .locator("img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const get = await page.request.get(first.url);
    expect(get.status()).toBe(200);
    expect(get.headers()["content-type"]).toBe("image/png");
    expect(Number(get.headers()["content-length"])).toBe(first.sizeBytes);
    const range = await page.request.get(first.url, {
      headers: { Range: "bytes=0-7" },
    });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(8);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "ذخیره", exact: true })
      .click();
    await page.reload();
    await expect(page.locator(`img[src="${first.url}"]`).first()).toBeVisible();
    if (process.env.EVENTOS_MEDIA_ACCEPTANCE_STAGE === "upload") {
      writeFileSync(
        ".local/media-persistence.json",
        JSON.stringify({ url: first.url, file }),
        { mode: 0o600 },
      );
      return;
    }
    await page
      .getByRole("row")
      .filter({ hasText: "contract-law-webinar" })
      .getByRole("button", { name: "ویرایش", exact: true })
      .click();
    await page.getByRole("button", { name: "رسانه", exact: true }).click();
    await page.screenshot({
      path: "test-results/development-local-media.png",
      fullPage: true,
    });
    const second = await upload();
    expect(second.id).not.toBe(first.id);
    expect(storedFileExists(file)).toBe(false);
    expect((await page.request.get(first.url)).status()).toBe(404);
    const secondFile = mediaPath(
      mediaRoot ?? env.MEDIA_LOCAL_ROOT ?? "",
      ...(await keyFor(second.id)).split("/"),
    );
    expect(storedFileExists(secondFile)).toBe(true);
    await uploader.getByRole("button", { name: "حذف", exact: true }).click();
    const deletion = page.waitForResponse(
      (response) =>
        response.url().includes("/api/tenant/media?") &&
        response.request().method() === "DELETE",
    );
    await uploader
      .getByRole("button", { name: "حذف رسانه", exact: true })
      .click();
    expect((await deletion).status()).toBe(200);
    await expect(uploader.locator("img")).toHaveCount(0);
    expect(
      (
        await tenant.query(
          "SELECT id FROM tenant_media WHERE tenant_id=$1 AND id=$2",
          [registry.rows[0].id, second.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(storedFileExists(secondFile)).toBe(false);
    expect((await page.request.get(second.url)).status()).toBe(404);
  } finally {
    await tenant?.end();
    await control.end();
  }
});
