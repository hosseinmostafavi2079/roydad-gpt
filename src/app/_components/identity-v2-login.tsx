"use client";
import { useEffect, useState, type FormEvent } from "react";
import { TenantSignInForm } from "./tenant-sign-in-form";
import { ParticipantRegisterForm } from "./participant-register-form";
import {
  IdentityProfileFields,
  type ProfileValues,
} from "./identity-profile-fields";
import type {
  ProfileField,
  LoginMethods,
} from "@/modules/tenant-identity/identity-v2-schema";
import { authContinuePath } from "@/modules/tenant-identity/auth-destination";

export function IdentityV2Login({
  methods,
  fields,
  register,
  next,
}: {
  methods: LoginMethods;
  fields: ProfileField[];
  register: boolean;
  next: string | null;
}) {
  const [mode, setMode] = useState<"sms" | "username" | "email">(
    methods.sms_otp
      ? "sms"
      : methods.email_password || methods.email_otp || methods.google
        ? "email"
        : "username",
  );
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [values, setValues] = useState<ProfileValues>({});
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expires, setExpires] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cooldown <= 0 && expires <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
      setExpires((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown, expires]);
  async function request(path: string, body: unknown) {
    const response = await fetch(`/api/tenant-auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      throw new Error(
        data?.error?.message ?? data?.message ?? "درخواست انجام نشد.",
      );
    }
    return response;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "username") {
        await request("/sign-in/username", { username, password });
        window.location.assign(authContinuePath(next));
        return;
      }
      if (!sent) {
        await request("/phone-number/send-otp", { phoneNumber: phone });
        setSent(true);
        setCooldown(60);
        setExpires(300);
        return;
      }
      await request("/phone-number/verify", {
        phoneNumber: phone,
        code,
        ...(register
          ? {
              profile: values,
              ...(methods.username_password
                ? { username, ...(password ? { password } : {}) }
                : {}),
            }
          : {}),
      });
      window.location.assign(authContinuePath(next));
    } catch (error) {
      setError(error instanceof Error ? error.message : "درخواست انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    try {
      await request("/phone-number/send-otp", { phoneNumber: phone });
      setCooldown(60);
      setExpires(300);
      setCode("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "ارسال کد انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <fieldset
        className="tenant-auth-modes"
        aria-label="روش ورود"
        style={{ border: 0, padding: 0, minWidth: 0 }}
      >
        {methods.sms_otp && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setMode("sms");
              setError("");
            }}
          >
            ورود با پیامک
          </button>
        )}
        {methods.username_password && !register && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setMode("username");
              setError("");
            }}
          >
            نام کاربری و رمز عبور
          </button>
        )}
        {(methods.email_password || methods.email_otp || methods.google) && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setMode("email")}
          >
            ایمیل / گوگل
          </button>
        )}
      </fieldset>
      {mode === "email" ? (
        register ? (
          <ParticipantRegisterForm
            next={next ?? "/account"}
            passwordEnabled={methods.email_password}
            googleEnabled={methods.google}
          />
        ) : (
          <TenantSignInForm
            next={next}
            passwordEnabled={methods.email_password}
            otpEnabled={methods.email_otp}
            googleEnabled={methods.google}
          />
        )
      ) : (
        <form onSubmit={submit} aria-label="ورود هویت جدید">
          {mode === "sms" ? (
            <>
              <div className="field">
                <label htmlFor="identity-mobile">شماره موبایل</label>
                <input
                  id="identity-mobile"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  maxLength={40}
                  value={phone}
                  required
                  disabled={sent}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              {register && (
                <>
                  <IdentityProfileFields
                    fields={fields}
                    values={values}
                    onChange={setValues}
                    mode="signup"
                  />
                  {methods.username_password && (
                    <>
                      <div className="field">
                        <label htmlFor="identity-username">نام کاربری</label>
                        <input
                          id="identity-username"
                          dir="ltr"
                          autoComplete="username"
                          minLength={3}
                          maxLength={30}
                          required
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="identity-password">
                          رمز عبور (اختیاری، حداقل ۱۲ کاراکتر)
                        </label>
                        <input
                          id="identity-password"
                          type="password"
                          autoComplete="new-password"
                          minLength={12}
                          maxLength={128}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
              {sent && (
                <>
                  <div className="field">
                    <label htmlFor="identity-code">کد پیامکی</label>
                    <input
                      id="identity-code"
                      type="text"
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      required
                      onChange={(event) =>
                        setCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                    />
                  </div>
                  <p role="status">
                    {expires > 0
                      ? `اعتبار کد: ${expires} ثانیه`
                      : "کد منقضی شده است. کد جدید درخواست کنید."}
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || cooldown > 0}
                    onClick={resend}
                  >
                    {cooldown > 0
                      ? `ارسال مجدد تا ${cooldown} ثانیه`
                      : "ارسال مجدد کد"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setSent(false);
                      setCode("");
                    }}
                  >
                    تغییر شماره
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="login-username">نام کاربری</label>
                <input
                  id="login-username"
                  autoComplete="username"
                  dir="ltr"
                  maxLength={30}
                  value={username}
                  required
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">رمز عبور</label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || (mode === "sms" && sent && expires === 0)}
          >
            {busy
              ? "در حال بررسی…"
              : mode === "username"
                ? "ورود"
                : sent
                  ? "تأیید و ادامه"
                  : "ارسال کد"}
          </button>
        </form>
      )}
    </div>
  );
}
