"use client";

import { useState } from "react";
import { apiRequest, errorMessage } from "./api-client";

type Profile = {
  displayName: string;
  shortDescription: string;
  about: string;
  logoUrl: string;
  coverUrl: string;
  faviconUrl: string;
  phone: string;
  email: string;
  address: string;
  websiteUrl: string;
  socialUrl: string;
  contactHours: string;
  footerDescription: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  heroEnabled: boolean;
  featuredEnabled: boolean;
  aboutEnabled: boolean;
  contactEnabled: boolean;
  cardStyle: "SOFT" | "OUTLINED";
  radiusStyle: "SMALL" | "MEDIUM" | "LARGE";
};

const textFields: { key: keyof Profile; label: string; type?: string }[] = [
  { key: "displayName", label: "نام نمایشی مجموعه" },
  { key: "shortDescription", label: "معرفی کوتاه" },
  { key: "about", label: "درباره مجموعه" },
  { key: "logoUrl", label: "نشانی HTTPS لوگو", type: "url" },
  { key: "coverUrl", label: "نشانی HTTPS تصویر اصلی", type: "url" },
  { key: "faviconUrl", label: "نشانی HTTPS نشان مرورگر", type: "url" },
  { key: "phone", label: "تلفن عمومی", type: "tel" },
  { key: "email", label: "ایمیل عمومی", type: "email" },
  { key: "address", label: "نشانی" },
  { key: "websiteUrl", label: "نشانی وب‌سایت دیگر", type: "url" },
  { key: "socialUrl", label: "نشانی شبکه اجتماعی", type: "url" },
  { key: "contactHours", label: "ساعت پاسخ‌گویی" },
  { key: "footerDescription", label: "متن پایین صفحه" },
];

export function WebsiteEditor({ initial }: { initial: Profile }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  function set<K extends keyof Profile>(key: K, entry: Profile[K]) {
    setValue((current) => ({ ...current, [key]: entry }));
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await apiRequest("/api/tenant/website", { method: "PUT", body: value });
      setMessage("تغییرات ذخیره شد.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="website-editor" onSubmit={save}>
      <section className="card card-pad">
        <h2 className="card-title">اطلاعات مجموعه</h2>
        <div className="website-editor-grid">
          {textFields.map(({ key, label, type }) => (
            <label
              key={key}
              htmlFor={`website-${key}`}
              className={key === "about" ? "website-wide" : ""}
            >
              <span>{label}</span>
              {key === "about" ? (
                <textarea
                  id={`website-${key}`}
                  value={String(value[key])}
                  onChange={(event) => set(key, event.target.value)}
                  rows={6}
                />
              ) : (
                <input
                  id={`website-${key}`}
                  type={type || "text"}
                  value={String(value[key])}
                  onChange={(event) => set(key, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      </section>
      <section className="card card-pad">
        <h2 className="card-title">ظاهر و برند</h2>
        <div className="website-editor-grid">
          {(["primaryColor", "secondaryColor", "accentColor"] as const).map(
            (key) => (
              <label key={key}>
                <span>
                  {key === "primaryColor"
                    ? "رنگ اصلی"
                    : key === "secondaryColor"
                      ? "رنگ دوم"
                      : "رنگ تأکیدی"}
                </span>
                <input
                  type="color"
                  value={value[key]}
                  onChange={(event) => set(key, event.target.value)}
                />
              </label>
            ),
          )}
          <label>
            <span>سبک کارت‌ها</span>
            <select
              value={value.cardStyle}
              onChange={(event) =>
                set("cardStyle", event.target.value as Profile["cardStyle"])
              }
            >
              <option value="SOFT">نرم</option>
              <option value="OUTLINED">خط‌دار</option>
            </select>
          </label>
          <label>
            <span>گردی گوشه‌ها</span>
            <select
              value={value.radiusStyle}
              onChange={(event) =>
                set("radiusStyle", event.target.value as Profile["radiusStyle"])
              }
            >
              <option value="SMALL">کم</option>
              <option value="MEDIUM">متوسط</option>
              <option value="LARGE">زیاد</option>
            </select>
          </label>
        </div>
      </section>
      <section className="card card-pad">
        <h2 className="card-title">صفحه اصلی</h2>
        <div className="website-editor-toggles">
          {(
            [
              ["heroEnabled", "نمایش بخش معرفی"],
              ["featuredEnabled", "نمایش برنامه‌های ویژه"],
              ["aboutEnabled", "نمایش خلاصه درباره ما"],
              ["contactEnabled", "نمایش راه‌های ارتباطی"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={value[key]}
                onChange={(event) => set(key, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </section>
      <div className="website-editor-actions">
        <button
          className="button button-primary"
          disabled={saving}
          type="submit"
        >
          {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
        <a
          className="button button-secondary"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          پیش‌نمایش سایت
        </a>
        <span role="status">{message}</span>
      </div>
    </form>
  );
}
