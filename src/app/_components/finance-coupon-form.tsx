"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function FinanceCouponForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage("");
    const fields = new FormData(form);
    try {
      const response = await fetch("/api/tenant/payments/coupons", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: String(fields.get("code") ?? ""),
          discountType: String(fields.get("discountType") ?? "FIXED"),
          discountValue: String(fields.get("discountValue") ?? ""),
          currency: "IRR",
          maxUses: fields.get("maxUses") ? Number(fields.get("maxUses")) : null,
          startsAt: null,
          endsAt: null,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "ثبت کد انجام نشد.");
      form.reset();
      setMessage("کد تخفیف ثبت شد.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ثبت کد انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="public-register-form" onSubmit={submit}>
      <h3>کد تخفیف جدید</h3>
      <label>
        کد <input name="code" minLength={3} maxLength={64} required />
      </label>
      <label>
        نوع{" "}
        <select name="discountType">
          <option value="FIXED">مبلغ ثابت (ریال)</option>
          <option value="PERCENT">درصد (مقیاس ۱۰۰۰۰)</option>
        </select>
      </label>
      <label>
        مقدار <input name="discountValue" type="number" min="1" required />
      </label>
      <label>
        حداکثر استفاده <input name="maxUses" type="number" min="1" />
      </label>
      <button disabled={busy} type="submit">
        ثبت کد
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
