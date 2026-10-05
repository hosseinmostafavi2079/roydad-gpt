"use client";
import { useEffect, useState } from "react";
import { apiRequest, errorMessage } from "./api-client";
export function IdentityAccountMethods() {
  const [account, setAccount] = useState<{
    username: string | null;
    phoneNumber: string | null;
    phoneNumberVerified: boolean;
  } | null>(null);
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    apiRequest<{
      username: string | null;
      phoneNumber: string | null;
      phoneNumberVerified: boolean;
    }>("/api/tenant/identity/username")
      .then(setAccount)
      .catch((error) => setMessage(errorMessage(error)));
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [cooldown]);
  async function saveUsername() {
    setBusy(true);
    try {
      await apiRequest("/api/tenant/identity/username", {
        method: "POST",
        body: { username },
      });
      setAccount(await apiRequest("/api/tenant/identity/username"));
      setMessage(
        "نام کاربری ذخیره شد؛ رمز عبور حساب فعلی شما قابل استفاده است.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function verifyPhone() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/tenant-auth/phone-number/${sent ? "verify" : "send-otp"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phoneNumber: phone,
            ...(sent ? { code, updatePhoneNumber: true } : {}),
          }),
        },
      );
      if (!response.ok)
        throw new Error("شماره یا کد معتبر نیست یا ارسال در دسترس نیست.");
      if (sent) {
        setAccount(await apiRequest("/api/tenant/identity/username"));
        setSent(false);
        setCode("");
        setPhone("");
        setMessage("موبایل تأیید شد.");
      } else {
        setSent(true);
        setCooldown(60);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card card-pad">
      <h2>روش ورود حساب من</h2>
      <p>
        پیش از غیرفعال کردن روش ورود فعلی، یک روش جایگزین را برای حساب مدیر
        تأیید کنید.
      </p>
      <p>
        موبایل:{" "}
        <b dir="ltr">
          {account?.phoneNumberVerified ? account.phoneNumber : "تأیید نشده"}
        </b>
      </p>
      <div className="field">
        <label htmlFor="account-method-phone">موبایل حساب من</label>
        <input
          id="account-method-phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          value={phone}
          disabled={sent}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      {sent && (
        <div className="field">
          <label htmlFor="account-method-code">کد تأیید حساب من</label>
          <input
            id="account-method-code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
        </div>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || !phone}
        onClick={verifyPhone}
      >
        {sent ? "تأیید موبایل حساب من" : "ارسال کد موبایل حساب من"}
      </button>
      {sent && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={cooldown > 0 || busy}
          onClick={() => {
            setSent(false);
            setCode("");
          }}
        >
          {cooldown > 0
            ? `ارسال مجدد تا ${cooldown} ثانیه`
            : "تغییر شماره / ارسال مجدد"}
        </button>
      )}
      <p>نام کاربری: {account?.username ?? "تنظیم نشده"}</p>
      {!account?.username && (
        <>
          <div className="field">
            <label htmlFor="account-method-username">نام کاربری حساب من</label>
            <input
              id="account-method-username"
              dir="ltr"
              autoComplete="username"
              maxLength={30}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !username}
            onClick={saveUsername}
          >
            ذخیره نام کاربری حساب من
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
