"use client";

import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "@/app/_components/api-client";

export function TenantOwnerInviteForm({ tenantId }: { tenantId: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<{ invitationIssued: boolean }>(
        `/api/platform/tenants/${tenantId}/owner-invitation`,
        {
          method: "POST",
          body: { name, email },
        },
      );
      setMessage(
        result.invitationIssued
          ? "پیوند یک‌بارمصرف فعال‌سازی برای مدیر سازمان ارسال شد."
          : "مدیر سازمان قبلاً فعال شده است.",
      );
      setName("");
      setEmail("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad section">
      <h2 className="card-title">ارسال دعوت مدیر اصلی</h2>
      <p className="muted">
        با ارسال مجدد، پیوند قبلی باطل و یک پیوند تازه برای همان مدیر فرستاده
        می‌شود.
      </p>
      {message && (
        <p className="alert alert-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <form className="inline-form" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="first-owner-name">
            نام
          </label>
          <input
            className="input"
            id="first-owner-name"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="first-owner-email">
            ایمیل
          </label>
          <input
            className="input"
            id="first-owner-email"
            type="email"
            dir="ltr"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "در حال ارسال…" : "ارسال دعوت مدیر"}
        </button>
      </form>
    </section>
  );
}
