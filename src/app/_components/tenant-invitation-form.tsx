"use client";

import { useState, type FormEvent } from "react";
import { apiRequest } from "@/app/_components/api-client";

export function TenantInvitationForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("گذرواژه و تکرار آن یکسان نیستند.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/api/tenant/invitations/accept", {
        method: "POST",
        body: { token, password },
      });
      setComplete(true);
    } catch {
      setError("پیوند فعال‌سازی معتبر نیست یا منقضی شده است.");
    } finally {
      setBusy(false);
    }
  }

  if (complete) {
    return (
      <div className="alert alert-success" role="status">
        حساب شما فعال شد. اکنون می‌توانید وارد شوید.
      </div>
    );
  }
  return (
    <form onSubmit={submit}>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="new-password">
          گذرواژهٔ تازه
        </label>
        <input
          className="input"
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="hint">گذرواژه باید دست‌کم ۱۲ نویسه داشته باشد.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="confirm-password">
          تکرار گذرواژه
        </label>
        <input
          className="input"
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "در حال فعال‌سازی…" : "فعال‌سازی حساب"}
      </button>
    </form>
  );
}
