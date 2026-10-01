"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function FinanceProviderActions({
  providerKey,
  configured,
  enabled,
}: {
  providerKey: string;
  configured: boolean;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function update(method: "PUT" | "PATCH", body: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/tenant/payments/provider-config/${providerKey}`,
        {
          method,
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "تنظیم درگاه انجام نشد.");
      setMessage("تنظیمات ذخیره شد.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تنظیم درگاه انجام نشد.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {providerKey === "TEST" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => update("PUT", { config: {} })}
        >
          ثبت تنظیمات آزمایشی
        </button>
      )}
      {configured && (
        <button
          type="button"
          disabled={busy}
          onClick={() => update("PATCH", { enabled: !enabled })}
        >
          {enabled ? "غیرفعال‌سازی" : "فعال‌سازی"}
        </button>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
