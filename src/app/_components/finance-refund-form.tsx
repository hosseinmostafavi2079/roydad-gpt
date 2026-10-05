"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ConfirmationDialog } from "./admin-ui";

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
  const [pending, setPending] = useState<{
    reason: string;
    reference: string;
  } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending({
      reason: String(data.get("reason") ?? ""),
      reference: String(data.get("reference") ?? ""),
    });
  }
  async function confirmRefund() {
    if (!pending) return;
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
          reason: pending.reason,
          ...(method === "MANUAL" ? { reference: pending.reference } : {}),
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "بازپرداخت ثبت نشد.");
      setMessage("درخواست بازپرداخت ثبت شد.");
      setPending(null);
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
      <ConfirmationDialog
        open={pending !== null}
        title="تأیید بازپرداخت"
        description="بازپرداخت این تراکنش را تأیید می‌کنید؟"
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmRefund()}
        confirmText="ثبت بازپرداخت"
      />
    </form>
  );
}
