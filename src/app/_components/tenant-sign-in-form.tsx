"use client";

import { createAuthClient } from "better-auth/react";
import { useState, type FormEvent } from "react";

export function TenantSignInForm({
  otpEnabled = false,
  passwordEnabled = true,
  next = "/dashboard",
}: {
  otpEnabled?: boolean;
  passwordEnabled?: boolean;
  next?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState<"password" | "otp">(
    passwordEnabled ? "password" : "otp",
  );
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "otp") {
        const response = await fetch("/api/tenant-auth/sign-in/email-otp", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, otp }),
        });
        if (!response.ok) throw new Error("invalid code");
        window.location.assign(next);
        return;
      }
      const auth = createAuthClient({ basePath: "/api/tenant-auth" });
      const result = await auth.signIn.email({
        email,
        password,
        callbackURL: next,
      });
      if (result.error) throw new Error("ایمیل یا گذرواژه درست نیست.");
      window.location.assign(next);
    } catch {
      setError(
        mode === "otp"
          ? "کد معتبر نیست یا منقضی شده است."
          : "ایمیل یا گذرواژه درست نیست.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/tenant-auth/email-otp/send-verification-otp",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        },
      );
      if (!response.ok) throw new Error("code request failed");
      setSent(true);
    } catch {
      setError("درخواست کد انجام نشد. کمی بعد دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="فرم ورود به سازمان">
      {otpEnabled && passwordEnabled && (
        <div className="auth-tabs">
          <button
            type="button"
            aria-pressed={mode === "password"}
            onClick={() => setMode("password")}
          >
            ورود با رمز عبور
          </button>
          <button
            type="button"
            aria-pressed={mode === "otp"}
            onClick={() => setMode("otp")}
          >
            ورود با کد ایمیلی
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="tenant-email">
          ایمیل
        </label>
        <input
          id="tenant-email"
          className="input"
          type="email"
          dir="ltr"
          autoComplete="username"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {mode === "otp" && (
        <div className="field">
          <label className="label" htmlFor="tenant-otp">
            کد یک‌بارمصرف ایمیلی
          </label>
          <input
            id="tenant-otp"
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            required
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !email}
            onClick={sendOtp}
          >
            {sent ? "ارسال دوباره کد" : "دریافت کد"}
          </button>
          {sent && (
            <p className="hint">
              اگر حسابی با این ایمیل وجود داشته باشد، کد ارسال شده است.
            </p>
          )}
        </div>
      )}
      {mode === "password" && (
        <div className="field">
          <label className="label" htmlFor="tenant-password">
            گذرواژه
          </label>
          <input
            id="tenant-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "در حال بررسی…" : "ورود امن"}
      </button>
    </form>
  );
}
