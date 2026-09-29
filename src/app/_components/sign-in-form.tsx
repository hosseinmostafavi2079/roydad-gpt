"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { useState, type FormEvent } from "react";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const auth = createAuthClient({ plugins: [twoFactorClient()] });
    try {
      if (!challenge) {
        const result = await auth.signIn.email({
          email,
          password,
          callbackURL: "/platform",
        });
        if (result.error) throw new Error("ایمیل یا گذرواژه درست نیست.");
        if (
          (result.data as { twoFactorRedirect?: boolean } | undefined)
            ?.twoFactorRedirect
        ) {
          setChallenge(true);
          return;
        }
      } else {
        const result = await auth.twoFactor.verifyTotp({
          code: code.replace(/\s/g, ""),
        });
        if (result.error)
          throw new Error(
            "کد یک‌بارمصرف معتبر نیست. کد تازه را از برنامهٔ احراز هویت وارد کنید.",
          );
      }
      window.location.assign("/platform");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "ورود انجام نشد. دوباره تلاش کنید.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="فرم ورود مدیر پلتفرم">
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      {!challenge ? (
        <>
          <div className="field">
            <label className="label" htmlFor="admin-email">
              ایمیل سازمانی
            </label>
            <input
              id="admin-email"
              className="input"
              type="email"
              dir="ltr"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="admin-password">
              گذرواژه
            </label>
            <input
              id="admin-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </>
      ) : (
        <div className="field">
          <label className="label" htmlFor="totp-code">
            کد برنامهٔ احراز هویت
          </label>
          <input
            id="totp-code"
            className="input mono"
            dir="ltr"
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
          <p className="hint">
            کد شش‌رقمی تازه را وارد کنید. هر کد فقط یک بار قابل استفاده است.
          </p>
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy
          ? "در حال بررسی…"
          : challenge
            ? "تأیید و ورود"
            : "ورود امن به پلتفرم"}
      </button>
      {challenge && (
        <button
          className="btn btn-secondary"
          type="button"
          style={{ width: "100%", marginTop: 9 }}
          onClick={() => {
            setChallenge(false);
            setCode("");
            setError("");
          }}
        >
          بازگشت به ورود
        </button>
      )}
    </form>
  );
}
