"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "@/app/_components/api-client";

type Plan = { id: string; code: string; name: string; isActive: boolean };

export function TenantCreateForm({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const activePlans = plans.filter((plan) => plan.isActive);
  const [planCode, setPlanCode] = useState(activePlans[0]?.code ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await apiRequest<{ tenant: { id: string } }>(
        "/api/platform/tenants",
        {
          method: "POST",
          body: {
            slug,
            legalName,
            displayName,
            planCode,
            ownerName,
            ownerEmail,
          },
        },
      );
      router.push(`/platform/tenants/${created.tenant.id}`);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!activePlans.length && (
        <p className="alert alert-error" role="alert">
          برای ایجاد سازمان، ابتدا یک طرح فعال بسازید.
        </p>
      )}
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="tenant-display">
            نام نمایشی سازمان
          </label>
          <input
            className="input"
            id="tenant-display"
            required
            minLength={2}
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="tenant-legal">
            نام ثبتی
          </label>
          <input
            className="input"
            id="tenant-legal"
            required
            minLength={2}
            maxLength={200}
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="tenant-slug">
            شناسهٔ زیردامنه
          </label>
          <input
            className="input mono"
            id="tenant-slug"
            dir="ltr"
            required
            minLength={2}
            maxLength={63}
            pattern="[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
            aria-describedby="slug-hint"
          />
          <p className="hint" id="slug-hint">
            فقط حروف انگلیسی کوچک، عدد و خط تیره؛ مانند acme-event.
          </p>
        </div>
        <div className="field">
          <label className="label" htmlFor="tenant-owner-name">
            نام مدیر اولیه
          </label>
          <input
            className="input"
            id="tenant-owner-name"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="tenant-owner-email">
            ایمیل مدیر اولیه
          </label>
          <input
            className="input"
            id="tenant-owner-email"
            type="email"
            dir="ltr"
            required
            maxLength={320}
            autoComplete="email"
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="tenant-plan">
            طرح اولیه
          </label>
          <select
            className="select"
            id="tenant-plan"
            required
            value={planCode}
            onChange={(event) => setPlanCode(event.target.value)}
          >
            {activePlans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="notice" style={{ marginTop: 17 }}>
        مدیر سازمان پس از راه‌اندازی، پیوند یک‌بارمصرف فعال‌سازی را دریافت می‌کند.
        پایگاه داده و دسترسی‌های پایه پیش از فعال‌شدن بررسی می‌شوند.
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !activePlans.length}
        >
          {busy ? "در حال ثبت سازمان…" : "ایجاد و شروع راه‌اندازی"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.back()}
        >
          بازگشت
        </button>
      </div>
    </form>
  );
}
