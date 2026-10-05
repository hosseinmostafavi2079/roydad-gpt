import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

type BrowserFlow = {
  ownerPage: Page;
  participantPage: Page;
  otherParticipantPage: Page;
  otherParticipantEmail: string;
  tenantOrigin: string;
  tenantId: string;
  sourceRunId: string;
};

export async function runPhase6BrowserFlows(input: BrowserFlow): Promise<void> {
  const { ownerPage, participantPage, tenantOrigin, tenantId, sourceRunId } =
    input;
  const control = new Client({
    connectionString: process.env.CONTROL_DATABASE_URL,
  });
  await control.connect();
  const registry = await control.query<{ database_name: string }>(
    "SELECT database_name FROM tenant_database_registry WHERE tenant_id=$1",
    [tenantId],
  );
  await control.end();
  const databaseName = registry.rows[0]?.database_name;
  if (!databaseName || !/^eventos_t_[0-9a-f]{32}$/.test(databaseName))
    throw new Error("Payment E2E tenant database is unavailable.");
  const runtimeUrl = new URL(process.env.TENANT_RUNTIME_DATABASE_URL ?? "");
  runtimeUrl.pathname = `/${databaseName}`;
  const db = new Client({ connectionString: runtimeUrl.toString() });
  await db.connect();
  try {
    const cloneRun = async (label: string) => {
      const title = `${label} ${randomUUID().slice(0, 8)}`;
      const copied = await db.query<{ id: string }>(
        `INSERT INTO program_runs
          (tenant_id,program_id,title,starts_at,ends_at,registration_starts_at,
           registration_ends_at,delivery_mode,capacity,minimum_capacity,
           waitlist_enabled,state,venue_id,notes,created_by,
           registration_form_schema,price_amount,price_currency)
         SELECT tenant_id,program_id,$3,starts_at,ends_at,registration_starts_at,
           registration_ends_at,'ONLINE',1,NULL,false,'PUBLISHED',NULL,notes,
           created_by,registration_form_schema,5000,'IRR'
         FROM program_runs WHERE tenant_id=$1 AND id=$2 RETURNING id`,
        [tenantId, sourceRunId, title],
      );
      const id = copied.rows[0]?.id;
      if (!id) throw new Error("Payment E2E run was not created.");
      return { id, title };
    };
    const successRun = await cloneRun("پرداخت موفق E2E");
    const failedRun = await cloneRun("پرداخت ناموفق E2E");
    const pendingRun = await cloneRun("پرداخت در انتظار E2E");

    await ownerPage.goto(`${tenantOrigin}/finance/settings`);
    await expect(
      ownerPage.getByRole("heading", { name: "تنظیمات پرداخت" }),
    ).toBeVisible();
    await ownerPage
      .getByRole("button", { name: "ثبت تنظیمات آزمایشی" })
      .click();
    await expect(ownerPage.getByRole("status")).toContainText(
      "تنظیمات ذخیره شد",
    );
    await ownerPage.getByRole("button", { name: "فعال‌سازی" }).click();
    await expect(ownerPage.getByText("فعال", { exact: true })).toBeVisible();
    const createCoupon = async (code: string) => {
      await ownerPage.goto(`${tenantOrigin}/finance/coupons`);
      await ownerPage.getByLabel("کد", { exact: true }).fill(code);
      await ownerPage.getByLabel("مقدار").fill("1000");
      await ownerPage.getByLabel("حداکثر استفاده").fill("1");
      await ownerPage.getByRole("button", { name: "ثبت کد" }).click();
      await expect(ownerPage.getByRole("status")).toContainText(
        "کد تخفیف ثبت شد",
      );
    };
    const successCoupon = `PAY${randomUUID().slice(0, 8).toUpperCase()}`;
    const pendingCoupon = `HOLD${randomUUID().slice(0, 8).toUpperCase()}`;
    await createCoupon(successCoupon);
    await createCoupon(pendingCoupon);
    const enroll = async (runId: string) => {
      await participantPage.goto(`${tenantOrigin}/events/${runId}`);
      await expect(
        participantPage.getByRole("radio", { name: /ثبت‌نام عادی/ }),
      ).toBeChecked();
      const response = participantPage.waitForResponse(
        (item) =>
          item.url().includes("/api/tenant/enrollments") &&
          item.request().method() === "POST",
      );
      await participantPage
        .getByRole("button", { name: "ثبت‌نام در دوره" })
        .click();
      const payload = (await (await response).json()) as {
        data: {
          id: string;
          status: string;
          paymentSummary: { payableAmount: string };
        };
      };
      expect(payload.data.status).toBe("AWAITING_PAYMENT");
      expect(payload.data.paymentSummary.payableAmount).toBe("5000");
      return payload.data.id;
    };
    const startScenario = async (
      enrollmentId: string,
      testScenario: string,
    ) => {
      const result = await participantPage.evaluate(
        async ({ enrollmentId, testScenario }) => {
          const response = await fetch("/api/tenant/payments/attempts", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              enrollmentId,
              providerKey: "TEST",
              testScenario,
            }),
          });
          return {
            status: response.status,
            payload: (await response.json()) as {
              data?: { paymentId: string; redirectUrl: string };
            },
          };
        },
        { enrollmentId, testScenario },
      );
      expect(result.status).toBe(200);
      const redirectUrl = result.payload.data?.redirectUrl;
      const paymentId = result.payload.data?.paymentId;
      if (!redirectUrl || !paymentId)
        throw new Error("TEST payment redirect is missing.");
      await participantPage.goto(redirectUrl);
      await participantPage.waitForURL(`**/account/payments/${paymentId}`);
      return { redirectUrl, paymentId };
    };

    const successfulEnrollment = await enroll(successRun.id);
    await participantPage.getByLabel("کد تخفیف").fill(successCoupon);
    await participantPage
      .getByRole("button", { name: "اعمال کد تخفیف" })
      .click();
    await expect(participantPage.getByRole("status")).toContainText("۴٬۰۰۰");
    const tamperStatus = await participantPage.evaluate(
      async (enrollmentId) =>
        (
          await fetch("/api/tenant/payments/attempts", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              enrollmentId,
              providerKey: "TEST",
              amount: "1",
            }),
          })
        ).status,
      successfulEnrollment,
    );
    expect(tamperStatus).toBe(400);
    await participantPage
      .getByRole("button", { name: "پرداخت با EventOS TEST" })
      .click();
    await participantPage.waitForURL(/\/account\/payments\/[0-9a-f-]{36}$/);
    const successPaymentId = participantPage.url().split("/").at(-1);
    if (!successPaymentId) throw new Error("Successful payment ID is missing.");
    const successAttempt = await db.query<{ id: string }>(
      `SELECT id FROM payment_attempts WHERE tenant_id=$1 AND payment_id=$2
       ORDER BY attempt_number DESC LIMIT 1`,
      [tenantId, successPaymentId],
    );
    const successAttemptId = successAttempt.rows[0]?.id;
    if (!successAttemptId) throw new Error("Successful attempt is missing.");
    const proof = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
      .update(`${successAttemptId}:SUCCEEDED`)
      .digest("hex");
    const successRedirect = `${tenantOrigin}/api/tenant/payments/callback/TEST?attempt=${successAttemptId}&outcome=SUCCEEDED&proof=${proof}`;
    await expect(
      participantPage.getByRole("heading", { name: "پرداخت موفق" }),
    ).toBeVisible();
    const invoice = await db.query<{ id: string }>(
      "SELECT id FROM invoices WHERE tenant_id=$1 AND payment_id=$2",
      [tenantId, successPaymentId],
    );
    const invoiceId = invoice.rows[0]?.id;
    if (!invoiceId) throw new Error("Payment E2E invoice is missing.");
    const pdf = await participantPage.request.get(
      `${tenantOrigin}/api/tenant/payments/invoices/${invoiceId}/pdf`,
      {
        headers: {
          cookie: (await participantPage.context().cookies(tenantOrigin))
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join("; "),
        },
      },
    );
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await participantPage.goto(successRedirect);
    await participantPage.waitForURL(`**/account/payments/${successPaymentId}`);
    const duplicate = await db.query<{
      count: number;
      used_count: number;
      payable_amount: string;
    }>(
      `SELECT (SELECT count(*)::int FROM invoices i WHERE i.tenant_id=p.tenant_id AND i.payment_id=p.id) AS count,
         c.used_count,p.payable_amount FROM payments p JOIN coupons c ON c.tenant_id=p.tenant_id AND c.id=p.coupon_id
       WHERE p.tenant_id=$1 AND p.id=$2`,
      [tenantId, successPaymentId],
    );
    expect(duplicate.rows[0]).toMatchObject({
      count: 1,
      used_count: 1,
      payable_amount: "4000",
    });

    const failedEnrollment = await enroll(failedRun.id);
    await startScenario(failedEnrollment, "FAILED");
    await expect(
      participantPage.getByRole("heading", { name: "پرداخت ناموفق" }),
    ).toBeVisible();
    const pendingEnrollment = await enroll(pendingRun.id);
    await participantPage.getByLabel("کد تخفیف").fill(pendingCoupon);
    await participantPage
      .getByRole("button", { name: "اعمال کد تخفیف" })
      .click();
    const pending = await startScenario(pendingEnrollment, "PENDING");
    await expect(
      participantPage.getByRole("heading", { name: "پرداخت در انتظار بررسی" }),
    ).toBeVisible();
    await db.query(
      "UPDATE enrollments SET payment_expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",
      [tenantId, pendingEnrollment],
    );
    const cleanup = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "scripts/payment-maintenance-once.ts",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(cleanup.status, cleanup.stderr.slice(-1000)).toBe(0);
    await participantPage.reload();
    await expect(
      participantPage.getByRole("heading", { name: "پرداخت ناموفق" }),
    ).toBeVisible();
    const released = await db.query<{
      enrollment_status: string;
      coupon_status: string;
    }>(
      `SELECT e.status AS enrollment_status,cr.status AS coupon_status
       FROM payments p JOIN enrollments e ON e.tenant_id=p.tenant_id AND e.id=p.enrollment_id
       JOIN coupon_reservations cr ON cr.tenant_id=p.tenant_id AND cr.payment_id=p.id
       WHERE p.tenant_id=$1 AND p.id=$2`,
      [tenantId, pending.paymentId],
    );
    expect(released.rows[0]).toEqual({
      enrollment_status: "EXPIRED",
      coupon_status: "RELEASED",
    });

    await ownerPage.goto(`${tenantOrigin}/finance`);
    await expect(
      ownerPage.getByRole("heading", { name: "نمای کلی" }),
    ).toBeVisible();
    await ownerPage.goto(`${tenantOrigin}/finance/transactions`);
    await expect(
      ownerPage.getByRole("row").filter({ hasText: successRun.title }),
    ).toBeVisible();
    await ownerPage.goto(`${tenantOrigin}/finance/invoices`);
    await expect(
      ownerPage.getByRole("link", { name: "PDF" }).first(),
    ).toBeVisible();
    await ownerPage.goto(`${tenantOrigin}/finance/refunds`);
    const refundCard = ownerPage
      .locator("article")
      .filter({ hasText: successRun.title });
    await refundCard.getByLabel("دلیل").fill("بازپرداخت آزمون");
    await refundCard.getByRole("button", { name: /بازپرداخت 4000/ }).click();
    await expect(
      ownerPage.getByRole("dialog", { name: "تأیید بازپرداخت" }),
    ).toBeVisible();
    const [refundResponse] = await Promise.all([
      ownerPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/tenant/payments/refunds") &&
          response.request().method() === "POST",
      ),
      ownerPage
        .getByRole("dialog", { name: "تأیید بازپرداخت" })
        .getByRole("button", { name: "ثبت بازپرداخت" })
        .click(),
    ]);
    expect(refundResponse.status()).toBe(200);
    await expect(
      ownerPage.getByRole("row").filter({ hasText: "بازپرداخت آزمون" }),
    ).toBeVisible();
    const otherUser = await db.query<{ id: string }>(
      'SELECT id FROM tenant_users WHERE "tenantId"=$1 AND email=$2',
      [tenantId, input.otherParticipantEmail],
    );
    const otherUserId = otherUser.rows[0]?.id;
    if (!otherUserId)
      throw new Error("Other participant fixture is unavailable.");
    await db.query(
      "INSERT INTO tenant_participant_profiles (tenant_id, user_id, display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [tenantId, otherUserId, "E2E Other Payment Participant"],
    );
    await db.query(
      "INSERT INTO tenant_user_roles (tenant_id, user_id, role_id) SELECT $1,$2,id FROM tenant_roles WHERE tenant_id=$1 AND code='participant' ON CONFLICT DO NOTHING",
      [tenantId, otherUserId],
    );
    const otherPage = input.otherParticipantPage;
    {
      await otherPage.goto(
        `${tenantOrigin}/account/payments/${successPaymentId}`,
      );
      await expect(
        otherPage.getByRole("heading", { name: "نتیجه پرداخت" }),
      ).toHaveCount(0);
      const otherCookies = (await otherPage.context().cookies(tenantOrigin))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
      const denied = await otherPage.request.get(
        `${tenantOrigin}/api/tenant/payments/invoices/${invoiceId}/pdf`,
        { headers: { cookie: otherCookies } },
      );
      expect(denied.status()).toBe(404);
    }
  } finally {
    await db.end();
  }
}
