"use client";

import { useState, type FormEvent } from "react";
import type { RegistrationForm } from "@/modules/enrollment/form";

export function PublicEnrollmentForm({
  runId,
  eventPath,
  form,
  priceAmount,
  priceCurrency,
}: {
  runId: string;
  eventPath: string;
  form: RegistrationForm;
  priceAmount: string;
  priceCurrency: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [pendingEnrollmentId, setPendingEnrollmentId] = useState<string | null>(
    null,
  );
  const [providers, setProviders] = useState<
    Array<{ key: string; displayName: string }>
  >([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [summary, setSummary] = useState<{
    originalAmount: string;
    discountAmount: string;
    payableAmount: string;
    currency: string;
  } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult("");
    const data = new FormData(event.currentTarget);
    const answers: Record<string, string | number | boolean> = {};
    for (const field of form.fields) {
      if (field.type === "checkbox") answers[field.key] = data.has(field.key);
      else if (field.type === "number") {
        const raw = String(data.get(field.key) ?? "");
        if (raw) answers[field.key] = Number(raw);
      } else {
        const raw = String(data.get(field.key) ?? "");
        if (raw) answers[field.key] = raw;
      }
    }
    try {
      const response = await fetch("/api/tenant/enrollments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, answers }),
      });
      if (response.status === 401) {
        window.location.assign(
          `/login?participant=1&next=${encodeURIComponent(eventPath)}`,
        );
        return;
      }
      const payload = (await response.json()) as {
        data?: {
          id: string;
          status: string;
          paymentSummary?: {
            originalAmount: string;
            discountAmount: string;
            payableAmount: string;
            currency: string;
          };
        };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message || "ثبت‌نام انجام نشد.");
      if (payload.data?.status === "AWAITING_PAYMENT") {
        setPendingEnrollmentId(payload.data.id);
        setSummary(payload.data.paymentSummary ?? null);
        const providerResponse = await fetch("/api/tenant/payments/providers", {
          credentials: "same-origin",
        });
        const providerPayload = (await providerResponse.json()) as {
          data?: Array<{ key: string; displayName: string }>;
        };
        const availableProviders = providerPayload.data ?? [];
        setProviders(availableProviders);
        setResult(
          availableProviders.length
            ? "برای تکمیل ثبت‌نام، پرداخت را از یک درگاه مجاز آغاز کنید."
            : "درگاه پرداخت فعالی موجود نیست. برای تکمیل ثبت‌نام با برگزارکننده تماس بگیرید.",
        );
      } else {
        setSummary(null);
        setResult(
          payload.data?.status === "WAITLISTED"
            ? "در فهرست انتظار قرار گرفتید."
            : "ثبت‌نام شما تأیید شد.",
        );
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : "ثبت‌نام انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  async function beginPayment(providerKey: string) {
    if (!pendingEnrollmentId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tenant/payments/attempts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollmentId: pendingEnrollmentId,
          providerKey,
        }),
      });
      const payload = (await response.json()) as {
        data?: { redirectUrl: string | null; state: string };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message || "پرداخت آغاز نشد.");
      if (payload.data?.redirectUrl)
        window.location.assign(payload.data.redirectUrl);
      else
        setResult(
          "درخواست پرداخت ثبت شد. وضعیت پرداخت پس از تأیید درگاه به‌روزرسانی می‌شود.",
        );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "پرداخت آغاز نشد.");
    } finally {
      setBusy(false);
    }
  }
  async function redeemCoupon() {
    if (!pendingEnrollmentId || !couponCode.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/tenant/payments/coupons/apply", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollmentId: pendingEnrollmentId,
          code: couponCode,
        }),
      });
      const payload = (await response.json()) as {
        data?: { status: string; payableAmount: string; currency: string };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message || "کد تخفیف معتبر نیست.");
      if (payload.data?.status === "CONFIRMED") {
        setPendingEnrollmentId(null);
        setResult("ثبت‌نام با تخفیف کامل تأیید شد.");
      } else {
        setSummary((current) =>
          current
            ? {
                ...current,
                discountAmount: (
                  BigInt(current.originalAmount) -
                  BigInt(payload.data?.payableAmount ?? current.originalAmount)
                ).toString(),
                payableAmount:
                  payload.data?.payableAmount ?? current.payableAmount,
              }
            : null,
        );
        setCouponApplied(true);
        setResult(
          `کد تخفیف اعمال شد. مبلغ قابل پرداخت: ${Number(payload.data?.payableAmount ?? "0").toLocaleString("fa-IR")} ${payload.data?.currency ?? ""}`,
        );
      }
    } catch (error) {
      setResult(
        error instanceof Error ? error.message : "کد تخفیف معتبر نیست.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="public-register-form" onSubmit={submit}>
      {BigInt(priceAmount) > 0n && (
        <fieldset>
          <legend>گزینه پرداخت</legend>
          <label>
            <input
              type="radio"
              name="priceOption"
              value="STANDARD"
              defaultChecked
            />
            ثبت‌نام عادی · {Number(priceAmount).toLocaleString("fa-IR")}{" "}
            {priceCurrency}
          </label>
        </fieldset>
      )}
      {form.fields.map((field) =>
        field.type === "radio" ? (
          <fieldset key={field.key}>
            <legend>
              {field.label}
              {field.required && " *"}
            </legend>
            {field.options.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name={field.key}
                  value={option}
                  required={field.required}
                />
                {option}
              </label>
            ))}
          </fieldset>
        ) : (
          <label key={field.key} htmlFor={`answer-${field.key}`}>
            {field.label}
            {field.required && " *"}
            {field.type === "textarea" ? (
              <textarea
                id={`answer-${field.key}`}
                name={field.key}
                required={field.required}
                maxLength={2000}
                rows={4}
              />
            ) : field.type === "select" ? (
              <select
                id={`answer-${field.key}`}
                name={field.key}
                required={field.required}
              >
                <option value="">انتخاب کنید</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`answer-${field.key}`}
                name={field.key}
                type={field.type === "phone" ? "tel" : field.type}
                required={field.required}
                maxLength={
                  field.type === "number" || field.type === "checkbox"
                    ? undefined
                    : 2000
                }
              />
            )}
          </label>
        ),
      )}
      <button type="submit" className="public-button" disabled={busy}>
        {busy ? "در حال بررسی…" : "ثبت‌نام در دوره"}
      </button>
      <p role="status">{result}</p>
      {pendingEnrollmentId && providers.length > 0 && (
        <fieldset>
          <legend>درگاه‌های پرداخت</legend>
          {summary && (
            <p>
              مبلغ اصلی: {summary.originalAmount} {summary.currency} · تخفیف:{" "}
              {summary.discountAmount} · مبلغ قابل پرداخت:{" "}
              {summary.payableAmount}
            </p>
          )}
          <label>
            کد تخفیف
            <input
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value)}
              maxLength={64}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            disabled={busy || couponApplied || !couponCode.trim()}
            onClick={redeemCoupon}
          >
            اعمال کد تخفیف
          </button>
          {providers.map((provider) => (
            <button
              key={provider.key}
              type="button"
              className="public-button"
              disabled={busy}
              onClick={() => beginPayment(provider.key)}
            >
              پرداخت با {provider.displayName}
            </button>
          ))}
        </fieldset>
      )}
    </form>
  );
}
