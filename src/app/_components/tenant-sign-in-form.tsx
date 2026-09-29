"use client";

import { createAuthClient } from "better-auth/react";
import { useState, type FormEvent } from "react";

export function TenantSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const auth = createAuthClient({ basePath: "/api/tenant-auth" });
      const result = await auth.signIn.email({
        email,
        password,
        callbackURL: "/dashboard",
      });
      if (result.error) throw new Error("ایمیل یا گذرواژه درست نیست.");
      window.location.assign("/dashboard");
    } catch {
      setError("ایمیل یا گذرواژه درست نیست.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="فرم ورود به سازمان">
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
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "در حال بررسی…" : "ورود امن"}
      </button>
    </form>
  );
}
