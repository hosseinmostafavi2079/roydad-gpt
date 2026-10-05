"use client";
import { useEffect, useState } from "react";
import {
  IdentityProfileFields,
  type ProfileValues,
} from "./identity-profile-fields";
import type { ProfileField } from "@/modules/tenant-identity/identity-v2-schema";
import { apiRequest, errorMessage } from "./api-client";
type Profile = {
  fields: ProfileField[];
  values: ProfileValues;
  username: string | null;
  usernameEnabled: boolean;
};
export function IdentityProfileEditor() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    apiRequest<Profile>("/api/tenant/identity/profile")
      .then(setProfile)
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
  async function save() {
    if (!profile) return;
    setBusy(true);
    setMessage("");
    try {
      const editable = new Set(
        profile.fields
          .filter((field) => field.userEditable && field.key !== "mobile")
          .map((field) => field.key),
      );
      await apiRequest("/api/tenant/identity/profile", {
        method: "PATCH",
        body: {
          values: Object.fromEntries(
            Object.entries(profile.values).filter(([key]) => editable.has(key)),
          ),
        },
      });
      setMessage("پروفایل ذخیره شد.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function mobile() {
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
        throw new Error("کد یا درخواست معتبر نیست. کمی بعد دوباره تلاش کنید.");
      if (sent) {
        setSent(false);
        setCode("");
        setPhone("");
        setProfile(await apiRequest<Profile>("/api/tenant/identity/profile"));
        setMessage("شماره موبایل تأیید و ذخیره شد.");
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
  async function saveUsername() {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/tenant/identity/username", {
        method: "POST",
        body: { username },
      });
      setProfile(await apiRequest<Profile>("/api/tenant/identity/profile"));
      setMessage("نام کاربری ذخیره شد.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="public-section">
      <h2>پروفایل من</h2>
      {profile && (
        <>
          <p>نام کاربری: {profile.username ?? "تنظیم نشده"}</p>
          {profile.usernameEnabled && !profile.username && (
            <div className="field">
              <label htmlFor="profile-new-username">نام کاربری حساب من</label>
              <input
                id="profile-new-username"
                dir="ltr"
                autoComplete="username"
                minLength={3}
                maxLength={30}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || !username}
                onClick={saveUsername}
              >
                ذخیره نام کاربری حساب من
              </button>
            </div>
          )}
          <IdentityProfileFields
            fields={profile.fields}
            values={profile.values}
            onChange={(values) => setProfile({ ...profile, values })}
            mode="profile"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={save}
          >
            ذخیره پروفایل
          </button>
          <h3>تغییر موبایل با تأیید پیامکی</h3>
          <p>
            موبایل تأییدشده:{" "}
            <b dir="ltr">{String(profile.values.mobile ?? "")}</b>
          </p>
          <div className="field">
            <label htmlFor="profile-new-mobile">شماره جدید</label>
            <input
              id="profile-new-mobile"
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
              <label htmlFor="profile-mobile-code">کد تأیید شماره جدید</label>
              <input
                id="profile-mobile-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
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
            onClick={mobile}
          >
            {sent ? "تأیید شماره جدید" : "ارسال کد تأیید شماره جدید"}
          </button>
          {sent && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || cooldown > 0}
                onClick={() => {
                  setSent(false);
                  setCode("");
                }}
              >
                {cooldown > 0
                  ? `ارسال مجدد تا ${cooldown} ثانیه`
                  : "تغییر شماره / درخواست مجدد"}
              </button>
              <p>کد تا ۵ دقیقه معتبر است.</p>
            </>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
