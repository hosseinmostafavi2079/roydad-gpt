"use client";
import { useEffect, useState } from "react";
import { apiRequest, errorMessage } from "./api-client";
import {
  defaultProfileFields,
  type LoginMethods,
  type ProfileField,
} from "@/modules/tenant-identity/identity-v2-schema";

type Provider = {
  key: string;
  allowed: boolean;
  configurationFields?: {
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
  }[];
};
type Settings = {
  publicSmsConfig?: Record<string, string>;
  methods: LoginMethods;
  fields: ProfileField[];
  providerKey: string | null;
  configured: boolean;
  providers: Provider[];
};
const methodLabels: Record<keyof LoginMethods, string> = {
  sms_otp: "ورود با پیامک",
  username_password: "نام کاربری و رمز عبور",
  email_password: "ایمیل و رمز عبور",
  email_otp: "کد ایمیلی",
  google: "گوگل",
};
export function IdentitySettingsEditor({ editable }: { editable: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providerKey, setProviderKey] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [testPhone, setTestPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiRequest<Settings>("/api/tenant/identity/settings")
      .then((value) => {
        setSettings(value);
        setConfig(value.publicSmsConfig ?? {});
        setProviderKey(
          value.providerKey ??
            value.providers.find((provider) => provider.allowed)?.key ??
            value.providers[0]?.key ??
            "",
        );
      })
      .catch((error) => setMessage(errorMessage(error)));
  }, []);
  async function action(method: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/tenant/identity/settings", {
        method,
        body,
      });
      setMessage("ذخیره شد.");
      const value = await apiRequest<Settings>("/api/tenant/identity/settings");
      setSettings(value);
      setConfig(value.publicSmsConfig ?? {});
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!settings) return <p role="status">در حال دریافت تنظیمات…</p>;
  const updateField = (key: string, patch: Partial<ProfileField>) =>
    setSettings({
      ...settings,
      fields: settings.fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    });
  const reorder = (index: number, direction: number) => {
    const next = [...settings.fields].sort((a, b) => a.order - b.order);
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    [next[index], next[target]] = [other, current];
    setSettings({
      ...settings,
      fields: next.map((field, order) => ({ ...field, order })),
    });
  };
  const selected = settings.providers.find(
    (provider) => provider.key === providerKey,
  );
  return (
    <div className="detail-grid">
      <section className="card card-pad">
        <h2>ورود و ثبت‌نام</h2>
        <p>حداقل یک روش قابل استفاده برای حساب مدیر باید فعال بماند.</p>
        <fieldset disabled={!editable || busy}>
          {Object.entries(methodLabels).map(([key, label]) => (
            <label className="check-row" key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={settings.methods[key as keyof LoginMethods]}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    methods: {
                      ...settings.methods,
                      [key]: event.target.checked,
                    },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      </section>
      <section className="card card-pad">
        <h2>پیامک</h2>
        <p>وضعیت: {settings.configured ? "پیکربندی شده" : "پیکربندی نشده"}</p>
        <fieldset disabled={!editable || busy}>
          <div className="field">
            <label htmlFor="sms-provider">ارائه‌دهنده</label>
            <select
              id="sms-provider"
              value={providerKey}
              onChange={(event) => {
                setProviderKey(event.target.value);
                setConfig({});
              }}
            >
              {settings.providers
                .filter((provider) => provider.allowed)
                .map((provider) => (
                  <option key={provider.key} value={provider.key}>
                    {provider.key === "KAVENEGAR" ? "کاوه‌نگار" : provider.key}
                  </option>
                ))}
            </select>
          </div>
          {!selected?.allowed && (
            <p>ابتدا مدیر پلتفرم باید این ارائه‌دهنده را مجاز کند.</p>
          )}
          {selected?.configurationFields?.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={`sms-${field.key}`}>{field.label}</label>
              <input
                id={`sms-${field.key}`}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                dir="ltr"
                maxLength={256}
                value={config[field.key] ?? ""}
                placeholder={
                  field.secret && settings.configured
                    ? "••••••••••••"
                    : field.key === "otpTemplate"
                      ? "verify"
                      : ""
                }
                onChange={(event) =>
                  setConfig({ ...config, [field.key]: event.target.value })
                }
              />
            </div>
          ))}
          <button
            className="btn btn-primary"
            type="button"
            disabled={!selected?.allowed}
            onClick={() =>
              action("POST", {
                action: "configure",
                providerKey,
                config: Object.fromEntries(
                  Object.entries(config).filter(([, value]) => value !== ""),
                ),
              })
            }
          >
            ذخیره پیامک
          </button>
          <div className="field">
            <label htmlFor="sms-test-phone">
              شماره مقصد پیامک آزمایشی بررسی پیکربندی
            </label>
            <input
              id="sms-test-phone"
              type="tel"
              dir="ltr"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!settings.configured || !testPhone}
            onClick={() => action("POST", { action: "test", phone: testPhone })}
          >
            ارسال پیامک آزمایشی
          </button>
          <small>کد آزمایشی برای ورود معتبر نیست.</small>
        </fieldset>
      </section>
      <section className="card card-pad" style={{ gridColumn: "1 / -1" }}>
        <h2>فرم اطلاعات کاربران</h2>
        <p>
          این فرم مربوط به حساب شرکت‌کننده است؛ فرم اختصاصی ثبت‌نام رویداد جدا
          باقی می‌ماند.
        </p>
        <fieldset disabled={!editable || busy}>
          {[...settings.fields]
            .sort((a, b) => a.order - b.order)
            .map((field, index) => {
              const protectedField = [
                "first_name",
                "last_name",
                "mobile",
              ].includes(field.key);
              return (
                <details key={field.key} className="card card-pad">
                  <summary>
                    {field.label} {field.required ? "(ضروری)" : ""}
                  </summary>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={`field-label-${index}`}>عنوان</label>
                      <input
                        id={`field-label-${index}`}
                        maxLength={80}
                        value={field.label}
                        onChange={(event) =>
                          updateField(field.key, { label: event.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`field-helper-${index}`}>راهنما</label>
                      <input
                        id={`field-helper-${index}`}
                        maxLength={240}
                        value={field.helperText}
                        onChange={(event) =>
                          updateField(field.key, {
                            helperText: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`field-type-${index}`}>نوع</label>
                      <select
                        id={`field-type-${index}`}
                        value={field.type}
                        disabled={protectedField}
                        onChange={(event) =>
                          updateField(field.key, {
                            type: event.target.value as ProfileField["type"],
                          })
                        }
                      >
                        {[
                          "TEXT",
                          "TEXTAREA",
                          "NUMBER",
                          "SELECT",
                          "MULTI_SELECT",
                          "CHECKBOX",
                          "DATE",
                        ].map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`field-placeholder-${index}`}>
                        متن نمونه
                      </label>
                      <input
                        id={`field-placeholder-${index}`}
                        maxLength={120}
                        value={field.placeholder}
                        onChange={(event) =>
                          updateField(field.key, {
                            placeholder: event.target.value,
                          })
                        }
                      />
                    </div>
                    {["SELECT", "MULTI_SELECT"].includes(field.type) && (
                      <div className="field">
                        <label htmlFor={`field-options-${index}`}>
                          گزینه‌ها، هر گزینه یک خط
                        </label>
                        <textarea
                          id={`field-options-${index}`}
                          maxLength={2400}
                          value={field.options.join("\n")}
                          onChange={(event) =>
                            updateField(field.key, {
                              options: event.target.value.split("\n"),
                            })
                          }
                        />
                      </div>
                    )}
                    {(
                      [
                        "enabled",
                        "required",
                        "showDuringSignup",
                        "showInProfile",
                        "userEditable",
                        "adminVisible",
                      ] as const
                    ).map((key) => (
                      <label className="check-row" key={key}>
                        <span>
                          {
                            {
                              enabled: "فعال",
                              required: "ضروری",
                              showDuringSignup: "نمایش هنگام ثبت‌نام",
                              showInProfile: "نمایش در پروفایل",
                              userEditable: "قابل ویرایش توسط کاربر",
                              adminVisible: "نمایش برای کارکنان مجاز",
                            }[key]
                          }
                        </span>
                        <input
                          type="checkbox"
                          checked={field[key]}
                          disabled={
                            protectedField &&
                            [
                              "enabled",
                              "required",
                              "showDuringSignup",
                            ].includes(key)
                          }
                          onChange={(event) =>
                            updateField(field.key, {
                              [key]: event.target.checked,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => reorder(index, -1)}
                    disabled={index === 0}
                  >
                    بالا
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => reorder(index, 1)}
                    disabled={index === settings.fields.length - 1}
                  >
                    پایین
                  </button>
                  {!protectedField &&
                    !defaultProfileFields.some(
                      (entry) => entry.key === field.key,
                    ) && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            fields: settings.fields.filter(
                              (entry) => entry.key !== field.key,
                            ),
                          })
                        }
                      >
                        حذف فیلد
                      </button>
                    )}
                </details>
              );
            })}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={settings.fields.length >= 40}
            onClick={() => {
              let key = `custom_${settings.fields.length}`;
              while (settings.fields.some((field) => field.key === key))
                key += "x";
              setSettings({
                ...settings,
                fields: [
                  ...settings.fields,
                  {
                    ...defaultProfileFields[0]!,
                    key,
                    label: "فیلد جدید",
                    required: false,
                    order: settings.fields.length,
                  },
                ],
              });
            }}
          >
            افزودن فیلد
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              action("PUT", {
                methods: settings.methods,
                fields: settings.fields,
              })
            }
          >
            ذخیره روش‌های ورود و فرم
          </button>
        </fieldset>
      </section>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
