import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { expect, test } from "@playwright/test";
import { currentTotp } from "../helpers/totp";
import { workerDiagnostics } from "../helpers/worker-diagnostics";

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

test("platform and tenant users retain MFA, isolation, RBAC, invitations, and portal boundaries", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(300_000);
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
  try {
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByLabel("ایمیل سازمانی").fill(email);
    await page.getByLabel("گذرواژه", { exact: true }).fill(password);
    await page.getByRole("button", { name: "ورود امن به پلتفرم" }).click();
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
    await page.getByLabel("کد شش‌رقمی برنامه").fill(currentTotp(secret));
    await page.getByRole("button", { name: "فعال‌سازی و ورود به پنل" }).click();
    await page.waitForURL("**/platform");
    await expect(
      page.getByRole("heading", { name: "به پنل EventOS خوش آمدید" }),
    ).toBeVisible();

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

    await page.goto("/platform/tenants/new");
    const slug = `e2e-${randomUUID().slice(0, 8)}`;
    const ownerName = "E2E Tenant Owner";
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    saveTenantState(null, slug);
    await page.getByLabel("نام نمایشی سازمان").fill("EventOS E2E Organization");
    await page.getByLabel("نام ثبتی").fill("EventOS E2E Organization Inc.");
    await page.getByLabel("شناسهٔ زیردامنه").fill(slug);
    await page.getByLabel("نام مدیر اولیه").fill(ownerName);
    await page.getByLabel("ایمیل مدیر اولیه").fill(ownerEmail);
    await page.getByRole("button", { name: "ایجاد و شروع راه‌اندازی" }).click();
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
    await expect(provisioningStatus).toHaveText("آماده و فعال", {
      timeout: 45_000,
    });

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
    const crmEnabled = await page.evaluate(async (id) => {
      const response = await fetch(`/api/platform/tenants/${id}/features`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overrides: [{ key: "crm", enabled: true }],
        }),
      });
      return response.status;
    }, tenantId);
    expect(crmEnabled).toBe(200);

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
    const tenantOrigin = `http://${slug}.localhost:3000`;
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

    await page.getByRole("link", { name: "نقش‌ها و دسترسی‌ها" }).first().click();
    await expect(page.locator(".permission-group-title").first()).toBeVisible();
    await expect(page.getByText("دسترسی پرخطر").first()).toBeVisible();
    await page.getByLabel("شناسه").fill("e2e_read_only_staff");
    await page.getByLabel("نام", { exact: true }).fill("Read-only staff");
    await page.getByLabel("توضیح").fill("Read-only staff access for E2E.");
    await page
      .locator("label.check-row")
      .filter({ hasText: "staff.read" })
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "ایجاد نقش" }).click();
    await expect(page.getByRole("status")).toContainText("نقش ایجاد شد");
    await expect(
      page.getByRole("heading", { name: "Read-only staff" }),
    ).toBeVisible();

    const staffName = "E2E Read Only Staff";
    const staffEmail = `staff-${randomUUID()}@example.test`;
    await page.getByRole("link", { name: "کارکنان" }).first().click();
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
    await expect(
      staffPage.getByRole("link", { name: "کارکنان" }).first(),
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
    await staffPage.getByRole("link", { name: "کارکنان" }).first().click();
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
    ) {
      await page.goto(`${tenantOrigin}/${collection}`);
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
      await portalPage.waitForURL("**/dashboard");
      await expect(
        portalPage.getByRole("heading", { name: `سلام ${name}` }),
      ).toBeVisible();
      expect(
        await portalPage.evaluate(
          async () => (await fetch("/api/tenant/identity/staff")).status,
        ),
      ).toBe(403);
      const deniedPortal = await portalPage.goto(`${tenantOrigin}/staff`);
      expect(deniedPortal?.status()).toBe(404);
      await portalContext.close();
    }

    await invitePortalIdentity(
      "instructors",
      "E2E Instructor Identity",
      `instructor-${randomUUID()}@example.test`,
    );
    await invitePortalIdentity(
      "participants",
      "E2E Participant Identity",
      `participant-${randomUUID()}@example.test`,
    );

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
    await page.goto("http://localhost:3000/platform");

    const authenticatedStatus = await page.evaluate(
      async () => (await fetch("/api/platform/tenants")).status,
    );
    expect(authenticatedStatus).toBe(200);

    await page.goto("http://localhost:3000/platform/tenants/new");
    const secondSlug = `e2e-${randomUUID().slice(0, 8)}`;
    saveTenantState(null, secondSlug);
    await page.getByLabel("نام نمایشی سازمان").fill("EventOS E2E Tenant B");
    await page.getByLabel("نام ثبتی").fill("EventOS E2E Tenant B Inc.");
    await page.getByLabel("شناسهٔ زیردامنه").fill(secondSlug);
    await page.getByLabel("نام مدیر اولیه").fill("Tenant B Owner");
    await page
      .getByLabel("ایمیل مدیر اولیه")
      .fill(`owner-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "ایجاد و شروع راه‌اندازی" }).click();
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
    const secondTenantId = page.url().split("/").at(-1) ?? null;
    if (!secondTenantId)
      throw new Error("Tenant B page did not contain a tenant ID.");
    saveTenantState(secondTenantId, secondSlug);
    await expect(provisioningStatus).toHaveText("آماده و فعال", {
      timeout: 45_000,
    });

    const secondOrigin = `http://${secondSlug}.localhost:3000`;
    const crossTenantSession = await request.get(
      `${secondOrigin}/api/tenant/identity/staff`,
      {
        headers: {
          cookie: `${ownerCookie.name}=${ownerCookie.value}`,
        },
      },
    );
    expect(crossTenantSession.status()).toBe(401);
    const wrongHostAcceptance = await request.post(
      `${secondOrigin}/api/tenant/invitations/accept`,
      {
        data: {
          token: wrongHostToken,
          password: "wrong host attempt password",
        },
        headers: { origin: secondOrigin },
      },
    );
    expect(wrongHostAcceptance.status()).toBe(400);

    await page.getByRole("button", { name: "خروج امن" }).click();
    await page.waitForURL("**/sign-in");
    const revokedStatus = await page.evaluate(
      async () => (await fetch("/api/platform/tenants")).status,
    );
    expect(revokedStatus).toBe(401);
  } finally {
    await stopWorker(failWorker).catch(() => undefined);
    if (retryWorker) await stopWorker(retryWorker).catch(() => undefined);
    if (tenantId) saveTenantState(tenantId, null);
  }
});
