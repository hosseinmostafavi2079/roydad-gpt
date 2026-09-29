"use client";

import { useState } from "react";
import type { RegistrationForm } from "@/modules/enrollment/form";
import { apiRequest, errorMessage } from "./api-client";

type Field = RegistrationForm["fields"][number];
const types: { value: Field["type"]; label: string }[] = [
  { value: "text", label: "متن کوتاه" },
  { value: "textarea", label: "متن بلند" },
  { value: "number", label: "عدد" },
  { value: "email", label: "ایمیل" },
  { value: "phone", label: "تلفن" },
  { value: "select", label: "فهرست انتخاب" },
  { value: "radio", label: "گزینه‌ای" },
  { value: "checkbox", label: "بله / خیر" },
  { value: "date", label: "تاریخ" },
];

export function RegistrationFormEditor({
  runId,
  initial,
}: {
  runId: string;
  initial: RegistrationForm;
}) {
  const [fields, setFields] = useState<Field[]>(initial.fields);
  const [fieldIds, setFieldIds] = useState(() =>
    initial.fields.map((field) => field.key),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function update(index: number, change: Partial<Field>) {
    setFields((current) =>
      current.map((field, offset) =>
        offset === index ? { ...field, ...change } : field,
      ),
    );
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/api/tenant/runs/${runId}/registration-form`, {
        method: "PUT",
        body: { fields },
      });
      setMessage(
        "فرم ثبت‌نام ذخیره شد. پاسخ‌های قبلی با نسخه زمان ثبت‌نام باقی می‌مانند.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="registration-form-editor">
      <p className="hint">
        فیلدهای تکمیلی اختیاری‌اند. اطلاعات پایه حساب به‌صورت جداگانه دریافت
        می‌شود.
      </p>
      {fields.map((field, index) => (
        <section className="card card-pad" key={fieldIds[index]}>
          <div className="website-editor-grid">
            <label>
              <span>عنوان سؤال</span>
              <input
                value={field.label}
                onChange={(event) =>
                  update(index, { label: event.target.value })
                }
                maxLength={120}
              />
            </label>
            <label>
              <span>کلید انگلیسی یکتا</span>
              <input
                dir="ltr"
                value={field.key}
                onChange={(event) => update(index, { key: event.target.value })}
                pattern="[a-z][a-z0-9_]*"
                maxLength={40}
              />
            </label>
            <label>
              <span>نوع پاسخ</span>
              <select
                value={field.type}
                onChange={(event) =>
                  update(index, { type: event.target.value as Field["type"] })
                }
              >
                {types.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="website-editor-toggles">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) =>
                  update(index, { required: event.target.checked })
                }
              />
              پاسخ لازم است
            </label>
            {(field.type === "select" || field.type === "radio") && (
              <label className="website-wide">
                <span>گزینه‌ها، هر کدام در یک خط</span>
                <textarea
                  value={field.options.join("\n")}
                  onChange={(event) =>
                    update(index, {
                      options: event.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={4}
                />
              </label>
            )}
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setFields((current) =>
                current.filter((_, offset) => offset !== index),
              );
              setFieldIds((current) =>
                current.filter((_, offset) => offset !== index),
              );
            }}
          >
            حذف سؤال
          </button>
        </section>
      ))}
      <div className="website-editor-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={fields.length >= 30}
          onClick={() => {
            setFieldIds((current) => [...current, crypto.randomUUID()]);
            setFields((current) => [
              ...current,
              {
                key: `field_${current.length + 1}`,
                label: "سؤال جدید",
                type: "text",
                required: false,
                options: [],
              },
            ]);
          }}
        >
          افزودن سؤال
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? "در حال ذخیره…" : "ذخیره فرم"}
        </button>
        <span role="status">{message}</span>
      </div>
    </div>
  );
}
