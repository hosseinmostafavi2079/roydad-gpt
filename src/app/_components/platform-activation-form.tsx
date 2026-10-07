"use client";
import Link from "next/link";
import { useState } from "react";
import { activateAdminSchema } from "@/modules/platform/admins/schema";
import { AdminButton } from "./admin-ui";
export function PlatformActivationForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const parsed = activateAdminSchema.safeParse(
      Object.fromEntries(new FormData(form)),
    );
    if (!parsed.success) {
      setError("ایمیل، کد و رمز ۲۴ تا ۱۲۸ کاراکتری و تکرار آن را بررسی کنید.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/platform-activation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) throw new Error();
      form.reset();
      setSuccess(true);
    } catch {
      setError("اطلاعات فعال‌سازی معتبر نیست یا منقضی شده است.");
    } finally {
      setBusy(false);
    }
  }
  if (success)
    return (
      <div role="status">
        <p>حساب مدیر فعال شد. اکنون می‌توانید وارد شوید.</p>
        <Link className="btn btn-primary" href="/sign-in">
          ورود به پلتفرم
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="form-stack" autoComplete="off">
      <label className="field">
        ایمیل
        <input
          className="input"
          name="email"
          type="email"
          dir="ltr"
          required
          maxLength={320}
          autoComplete="username"
        />
      </label>
      <label className="field">
        کد فعال‌سازی
        <input
          className="input"
          name="activationCode"
          type="password"
          dir="ltr"
          required
          maxLength={128}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        رمز عبور جدید
        <input
          className="input"
          name="password"
          type="password"
          required
          minLength={24}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      <label className="field">
        تکرار رمز عبور
        <input
          className="input"
          name="confirmPassword"
          type="password"
          required
          minLength={24}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      <p className="hint">
        رمز یکتا با ۲۴ تا ۱۲۸ کاراکتر انتخاب کنید. کد فعال‌سازی تا ۲۴ ساعت معتبر
        و فقط یک بار قابل استفاده است.
      </p>
      {error && <p role="alert">{error}</p>}
      <AdminButton type="submit" tone="primary" disabled={busy}>
        {busy ? "در حال فعال‌سازی..." : "فعال‌سازی حساب"}
      </AdminButton>
    </form>
  );
}
