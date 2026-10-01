"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function FinanceRefundForm({
  paymentId,
  amount,
  method,
}: {
  paymentId: string;
  amount: string;
  method: "PROVIDER" | "MANUAL";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!window.confirm("بازپرداخت این تراکنش را تأیید می‌کنید؟")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tenant/payments/refunds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentId,
          amount,
          method,
          reason: String(data.get("reason") ?? ""),
          ...(method === "MANUAL"
            ? { reference: String(data.get("reference") ?? "") }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "بازپرداخت ثبت نشد.");
      setMessage("درخواست بازپرداخت ثبت شد.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "بازپرداخت ثبت نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="public-register-form">
      <strong>
        {method === "PROVIDER"
          ? "بازپرداخت از طریق درگاه"
          : "ثبت بازپرداخت دستی"}
      </strong>
      <label>
        دلیل <input name="reason" required maxLength={500} />
      </label>
      {method === "MANUAL" && (
        <label>
          شماره مرجع دستی
          <input name="reference" required maxLength={255} />
        </label>
      )}
      <button type="submit" disabled={busy}>
        بازپرداخت {amount} ریال
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
