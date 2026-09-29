"use client";

import { createAuthClient } from "better-auth/react";
import { useState, type FormEvent } from "react";

export function ParticipantRegisterForm() {
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const auth = createAuthClient({ basePath: "/api/tenant-auth" });
      const result = await auth.signUp.email({
        name: String(form.get("name") || "").trim(),
        email: String(form.get("email") || "").trim(),
        password: String(form.get("password") || ""),
        callbackURL: "/login?participant=1",
      });
      if (result.error) throw new Error("Registration failed");
      setSubmitted(true);
    } catch {
      setError("ثبت‌نام انجام نشد. اطلاعات را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  if (submitted)
    return (
      <p role="status" className="public-empty">
        اگر ثبت‌نام انجام شده باشد، پیوند تأیید ایمیل برای شما ارسال می‌شود. پس از
        تأیید، وارد حساب خود شوید.
      </p>
    );
  return (
    <form className="public-register-form" onSubmit={submit}>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      <label>
        نام و نام خانوادگی
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
        />
      </label>
      <label>
        ایمیل
        <input
          name="email"
          type="email"
          required
          maxLength={320}
          dir="ltr"
          autoComplete="email"
        />
      </label>
      <label>
        گذرواژه
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      <button className="public-button" type="submit" disabled={busy}>
        {busy ? "در حال ثبت‌نام…" : "ایجاد حساب"}
      </button>
    </form>
  );
}
