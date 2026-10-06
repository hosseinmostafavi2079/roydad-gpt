"use client";
import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "./api-client";
export function OwnerSetupForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("password") !== data.get("confirmation")) {
      setMessage("گذرواژه‌ها یکسان نیستند.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/api/tenant/owner-bootstrap", {
        method: "POST",
        body: {
          username: data.get("username"),
          activationCode: data.get("activationCode"),
          password: data.get("password"),
        },
      });
      form.reset();
      setMessage("حساب فعال شد. اکنون با نام کاربری و گذرواژه وارد شوید.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-grid">
      <div className="field">
        <label htmlFor="setup-username" className="label">
          نام کاربری
        </label>
        <input
          id="setup-username"
          name="username"
          className="input"
          dir="ltr"
          required
          maxLength={30}
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label htmlFor="setup-code" className="label">
          کد راه‌اندازی
        </label>
        <input
          id="setup-code"
          name="activationCode"
          className="input"
          type="password"
          dir="ltr"
          required
          minLength={43}
          maxLength={43}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="setup-password" className="label">
          گذرواژه جدید
        </label>
        <input
          id="setup-password"
          name="password"
          className="input"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </div>
      <div className="field">
        <label htmlFor="setup-confirm" className="label">
          تکرار گذرواژه
        </label>
        <input
          id="setup-confirm"
          name="confirmation"
          className="input"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        فعال‌سازی مدیر اصلی
      </button>
      {message && <p role="status">{message}</p>}
      <a className="link" href="/login">
        ورود با نام کاربری
      </a>
    </form>
  );
}
