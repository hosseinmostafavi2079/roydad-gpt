"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { QRCodeSVG } from "qrcode.react";
import { useState, type FormEvent } from "react";

type Setup = { totpURI: string; backupCodes: string[] };

export function MfaEnrollment() {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const auth = createAuthClient({ plugins: [twoFactorClient()] });

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await auth.twoFactor.enable({ password, method: "totp" });
    setBusy(false);
    if (result.error) {
      setError("گذرواژه تأیید نشد یا راه‌اندازی احراز هویت کامل نشد.");
      return;
    }
    if (
      result.data.method !== "totp" ||
      !result.data.totpURI ||
      !result.data.backupCodes
    ) {
      setError("اطلاعات راه‌اندازی در دسترس نیست. دوباره تلاش کنید.");
      return;
    }
    setSetup({
      totpURI: result.data.totpURI,
      backupCodes: result.data.backupCodes,
    });
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await auth.twoFactor.verifyTotp({
      code: code.replace(/\s/g, ""),
    });
    setBusy(false);
    if (result.error) {
      setError("کد معتبر نیست؛ کد تازه را از برنامهٔ احراز هویت وارد کنید.");
      return;
    }
    window.location.assign("/platform");
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 680 }}>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      {!setup ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            برای دسترسی به پنل، برنامهٔ احراز هویت را با گذرواژهٔ فعلی حساب خود
            متصل کنید.
          </p>
          <form onSubmit={begin}>
            <div className="field" style={{ maxWidth: 420 }}>
              <label htmlFor="mfa-password" className="label">
                گذرواژهٔ فعلی
              </label>
              <input
                id="mfa-password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "در حال آماده‌سازی…" : "راه‌اندازی احراز هویت دو‌مرحله‌ای"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            کد QR را با برنامهٔ احراز هویت اسکن کنید، سپس کد شش‌رقمی را برای
            فعال‌سازی وارد کنید.
          </p>
          <div className="grid grid-2" style={{ alignItems: "start" }}>
            <div className="qr-panel">
              <QRCodeSVG value={setup.totpURI} size={180} level="M" />
              <span className="hint">EventOS Platform</span>
            </div>
            <div>
              <p className="label">کدهای بازیابی را در جای امن نگه دارید</p>
              <fieldset className="backup-codes">
                <legend className="sr-only">کدهای بازیابی یک‌بارمصرف</legend>
                {setup.backupCodes.map((backupCode) => (
                  <code className="backup-code" key={backupCode}>
                    {backupCode}
                  </code>
                ))}
              </fieldset>
              <p className="hint" style={{ marginTop: 8 }}>
                این کدها فقط یک بار نمایش داده می‌شوند.
              </p>
            </div>
          </div>
          <hr className="divider" />
          <form onSubmit={verify}>
            <div className="field" style={{ maxWidth: 320 }}>
              <label className="label" htmlFor="mfa-verify-code">
                کد شش‌رقمی برنامه
              </label>
              <input
                id="mfa-verify-code"
                className="input mono"
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "در حال بررسی…" : "فعال‌سازی و ورود به پنل"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
