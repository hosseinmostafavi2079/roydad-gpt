"use client";

import { useEffect, useState } from "react";
import type { SiteSettings } from "@/modules/public-site/profile";
import { MediaUploader } from "./media-uploader";
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
  siteSettings: SiteSettings;
};

const tabs = [
  "اطلاعات عمومی",
  "هویت بصری",
  "صفحه اصلی",
  "بخش‌ها",
  "تماس با ما",
  "شبکه‌های اجتماعی",
  "SEO",
  "پیش‌نمایش",
] as const;
const sectionLabels: Record<keyof SiteSettings["sections"], string> = {
  hero: "معرفی اصلی",
  featured: "رویدادهای ویژه",
  upcoming: "دوره‌های آینده",
  about: "درباره ما",
  instructors: "مدرسان",
  stats: "آمار مجموعه",
  contact: "تماس با ما",
  social: "شبکه‌های اجتماعی",
  newsletter: "خبرنامه / دعوت به اقدام",
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
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const [usage, setUsage] = useState<{
    imageBytes: number;
    videoBytes: number;
    totalBytes: number;
    limitBytes: number;
  } | null>(null);
  useEffect(() => {
    void apiRequest<typeof usage>("/api/tenant/media/usage")
      .then(setUsage)
      .catch(() => undefined);
  }, []);
  function set<K extends keyof Profile>(key: K, entry: Profile[K]) {
    setValue((current) => ({ ...current, [key]: entry }));
  }
  function setting<K extends keyof SiteSettings>(
    key: K,
    entry: SiteSettings[K],
  ) {
    setValue((current) => ({
      ...current,
      siteSettings: { ...current.siteSettings, [key]: entry },
    }));
  }
  function section(key: keyof SiteSettings["sections"], enabled: boolean) {
    setting("sections", { ...value.siteSettings.sections, [key]: enabled });
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
      <nav className="website-tabs" aria-label="بخش‌های وب‌سایت">
        {tabs.map((item) => (
          <button
            type="button"
            key={item}
            className={`btn ${tab === item ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <section
        className="card card-pad"
        hidden={
          !["اطلاعات عمومی", "تماس با ما", "شبکه‌های اجتماعی"].includes(tab)
        }
      >
        <h2 className="card-title">{tab}</h2>
        <div className="website-editor-grid">
          {textFields
            .filter(({ key }) =>
              tab === "اطلاعات عمومی"
                ? [
                    "displayName",
                    "shortDescription",
                    "about",
                    "websiteUrl",
                    "footerDescription",
                  ].includes(key)
                : tab === "تماس با ما"
                  ? ["phone", "email", "address", "contactHours"].includes(key)
                  : ["socialUrl"].includes(key),
            )
            .map(({ key, label, type }) => (
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
      <section className="card card-pad" hidden={tab !== "هویت بصری"}>
        <h2 className="card-title">ظاهر و برند</h2>
        {usage && (
          <p className="hint">
            فضای رسانه: {(usage.totalBytes / 1048576).toFixed(1)} از{" "}
            {(usage.limitBytes / 1048576).toFixed(0)} مگابایت · تصویر{" "}
            {(usage.imageBytes / 1048576).toFixed(1)} · ویدیو{" "}
            {(usage.videoBytes / 1048576).toFixed(1)}
          </p>
        )}
        <div className="media-grid">
          <MediaUploader
            kind="WEBSITE_LOGO"
            label="لوگو"
            value={value.logoUrl}
            onChange={(url) => set("logoUrl", url)}
          />
          <MediaUploader
            kind="WEBSITE_FAVICON"
            label="نشان مرورگر"
            value={value.faviconUrl}
            onChange={(url) => set("faviconUrl", url)}
          />
          <MediaUploader
            kind="WEBSITE_HERO"
            label="تصویر اصلی"
            value={value.coverUrl}
            onChange={(url) => set("coverUrl", url)}
          />
        </div>
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
          {(["backgroundColor", "textColor"] as const).map((key) => (
            <label key={key}>
              <span>
                {key === "backgroundColor" ? "رنگ پس‌زمینه" : "رنگ متن"}
              </span>
              <input
                type="color"
                value={value.siteSettings[key]}
                onChange={(event) => setting(key, event.target.value)}
              />
            </label>
          ))}
          <label>
            <span>قلم فارسی</span>
            <select
              value={value.siteSettings.fontPreset}
              onChange={(event) =>
                setting(
                  "fontPreset",
                  event.target.value as SiteSettings["fontPreset"],
                )
              }
            >
              <option value="VAZIRMATN">وزیرمتن</option>
              <option value="TAHOMA">تاهوما</option>
            </select>
          </label>
          <label>
            <span>سبک دکمه</span>
            <select
              value={value.siteSettings.buttonStyle}
              onChange={(event) =>
                setting(
                  "buttonStyle",
                  event.target.value as SiteSettings["buttonStyle"],
                )
              }
            >
              <option value="SOLID">پررنگ</option>
              <option value="OUTLINE">خط‌دار</option>
            </select>
          </label>
        </div>
      </section>
      <section className="card card-pad" hidden={tab !== "صفحه اصلی"}>
        <h2 className="card-title">صفحه اصلی</h2>
        <div className="website-editor-grid">
          {(
            [
              ["slogan", "شعار"],
              ["heroTitle", "عنوان اصلی"],
              ["heroSubtitle", "زیرعنوان"],
              ["heroCtaText", "متن دکمه"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={value.siteSettings[key]}
                onChange={(event) => setting(key, event.target.value)}
              />
            </label>
          ))}
          <label>
            <span>مقصد دکمه</span>
            <select
              value={value.siteSettings.heroCtaHref}
              onChange={(event) =>
                setting(
                  "heroCtaHref",
                  event.target.value as SiteSettings["heroCtaHref"],
                )
              }
            >
              <option value="/events">دوره‌ها و رویدادها</option>
              <option value="/about">درباره ما</option>
              <option value="/contact">تماس با ما</option>
            </select>
          </label>
          <label>
            <span>چیدمان معرفی</span>
            <select
              value={value.siteSettings.heroAlignment}
              onChange={(event) =>
                setting(
                  "heroAlignment",
                  event.target.value as SiteSettings["heroAlignment"],
                )
              }
            >
              <option value="START">راست‌چین</option>
              <option value="CENTER">وسط‌چین</option>
            </select>
          </label>
          <label>
            <span>عنوان درباره ما</span>
            <input
              value={value.siteSettings.aboutTitle}
              onChange={(event) => setting("aboutTitle", event.target.value)}
            />
          </label>
          <label>
            <span>سال تأسیس</span>
            <input
              type="number"
              min="1200"
              max="2100"
              value={value.siteSettings.foundingYear ?? ""}
              onChange={(event) =>
                setting(
                  "foundingYear",
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            />
          </label>
          <label className="website-wide">
            <span>ویژگی‌ها (هر خط یک مورد)</span>
            <textarea
              value={value.siteSettings.features.join("\n")}
              onChange={(event) =>
                setting(
                  "features",
                  event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <label className="website-wide">
            <span>آمار (هر خط: عدد | عنوان)</span>
            <textarea
              value={value.siteSettings.stats
                .map((stat) => `${stat.value} | ${stat.label}`)
                .join("\n")}
              onChange={(event) =>
                setting(
                  "stats",
                  event.target.value
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => {
                      const [number, ...rest] = line.split("|");
                      return {
                        value: number?.trim() ?? "",
                        label: rest.join("|").trim(),
                      };
                    }),
                )
              }
            />
          </label>
        </div>
        <MediaUploader
          kind="WEBSITE_ABOUT"
          label="تصویر درباره ما"
          value={value.siteSettings.aboutImageUrl}
          onChange={(url) => setting("aboutImageUrl", url)}
        />
      </section>
      <section className="card card-pad" hidden={tab !== "بخش‌ها"}>
        <h2 className="card-title">نمایش و ترتیب بخش‌ها</h2>
        {value.siteSettings.sectionOrder.map((key, index) => (
          <div className="website-section-row" key={key}>
            <label>
              <input
                type="checkbox"
                checked={value.siteSettings.sections[key]}
                onChange={(event) => section(key, event.target.checked)}
              />
              {sectionLabels[key]}
            </label>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                const order = [...value.siteSettings.sectionOrder];
                const previous = order[index - 1];
                const current = order[index];
                if (!previous || !current) return;
                order[index - 1] = current;
                order[index] = previous;
                setting("sectionOrder", order);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === value.siteSettings.sectionOrder.length - 1}
              onClick={() => {
                const order = [...value.siteSettings.sectionOrder];
                const current = order[index];
                const next = order[index + 1];
                if (!current || !next) return;
                order[index] = next;
                order[index + 1] = current;
                setting("sectionOrder", order);
              }}
            >
              ↓
            </button>
          </div>
        ))}
      </section>
      <section className="card card-pad" hidden={tab !== "تماس با ما"}>
        <div className="website-editor-grid">
          {(
            [
              ["mapUrl", "نشانی نقشه"],
              ["contactCtaText", "متن دکمه تماس"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={value.siteSettings[key]}
                onChange={(event) => setting(key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </section>
      <section className="card card-pad" hidden={tab !== "شبکه‌های اجتماعی"}>
        <div className="website-editor-grid">
          {(
            [
              ["whatsappUrl", "واتساپ"],
              ["telegramUrl", "تلگرام"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="url"
                value={value.siteSettings[key]}
                onChange={(event) => setting(key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </section>
      <section className="card card-pad" hidden={tab !== "SEO"}>
        <h2 className="card-title">نمایش در جستجو و اشتراک‌گذاری</h2>
        <div className="website-editor-grid">
          {(
            [
              ["seoTitle", "عنوان سایت"],
              ["metaDescription", "توضیح کوتاه برای موتور جستجو"],
              ["ogTitle", "عنوان اشتراک‌گذاری"],
              ["organizationDescription", "معرفی مجموعه"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={value.siteSettings[key]}
                onChange={(event) => setting(key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <MediaUploader
          kind="WEBSITE_SOCIAL"
          label="تصویر اشتراک‌گذاری"
          value={value.siteSettings.socialImageUrl}
          onChange={(url) => setting("socialImageUrl", url)}
        />
      </section>
      <section className="card card-pad" hidden={tab !== "پیش‌نمایش"}>
        <h2 className="card-title">پیش‌نمایش وب‌سایت</h2>
        <p>تغییرات را ذخیره کنید و سایت مجموعه را در زبانه تازه ببینید.</p>
        <a
          className="btn btn-secondary"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          باز کردن سایت مجموعه
        </a>
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
