"use client";

import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "./api-client";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  features: Record<string, boolean>;
  limits: Record<string, number>;
};
const featureGroups = [
  {
    title: "آموزش و رویداد",
    items: [
      ["courses", "دوره‌ها"],
      ["events", "رویدادها"],
      ["attendance", "حضور و غیاب"],
      ["qr_attendance", "حضور با QR"],
      ["quiz", "آزمون‌ها"],
      ["assignments", "تکلیف‌ها"],
      ["certificates", "گواهی‌ها"],
    ],
  },
  {
    title: "ارتباطات",
    items: [
      ["sms", "پیامک"],
      ["email", "ایمیل"],
      ["crm", "مدیریت ارتباط"],
    ],
  },
  {
    title: "سازمان و امکانات پیشرفته",
    items: [
      ["payments", "پرداخت"],
      ["branches", "شعب"],
      ["custom_domain", "دامنه اختصاصی"],
      ["ai", "هوش مصنوعی"],
    ],
  },
] as const;
const limits = [
  ["max_staff", "حداکثر کارکنان", 100000],
  ["max_participants", "حداکثر شرکت‌کنندگان", 10000000],
  ["max_active_runs", "حداکثر اجراهای فعال", 100000],
  ["max_storage_mb", "فضای ذخیره‌سازی (مگابایت)", 100000000],
  ["monthly_sms", "پیامک ماهانه", 100000000],
  ["monthly_email", "ایمیل ماهانه", 100000000],
  ["max_branches", "حداکثر شعب", 100000],
  ["max_custom_domains", "دامنه‌های اختصاصی", 1000],
] as const;

function values(form: FormData) {
  const features: Record<string, boolean> = {};
  const limitValues: Record<string, number> = {};
  for (const group of featureGroups)
    for (const [key] of group.items) features[key] = form.has(`feature:${key}`);
  for (const [key, , max] of limits) {
    const raw = String(form.get(`limit:${key}`) ?? "");
    const value = Number(raw);
    if (!raw || !Number.isInteger(value) || value < 0 || value > max)
      throw new Error("سقف‌ها باید عدد صحیح در محدوده مجاز باشند.");
    limitValues[key] = value;
  }
  return { features, limits: limitValues };
}

function PlanFields({ plan }: { plan?: Plan }) {
  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span className="label">نام طرح *</span>
          <input
            className="input"
            name="name"
            required
            maxLength={120}
            defaultValue={plan?.name}
          />
        </label>
        {!plan && (
          <label className="field">
            <span className="label">کد انگلیسی *</span>
            <input
              className="input mono"
              name="code"
              dir="ltr"
              required
              pattern="[a-z][a-z0-9_]{1,47}"
            />
          </label>
        )}
        <label className="field field-full">
          <span className="label">توضیح طرح</span>
          <input
            className="input"
            name="description"
            maxLength={500}
            defaultValue={plan?.description}
          />
        </label>
      </div>
      <h3 className="form-section-title">قابلیت‌ها</h3>
      <div className="feature-groups">
        {featureGroups.map((group) => (
          <fieldset className="permission-group" key={group.title}>
            <legend className="permission-group-title">{group.title}</legend>
            <div className="feature-grid">
              {group.items.map(([key, label]) => (
                <label className="feature-option" key={key}>
                  <input
                    type="checkbox"
                    name={`feature:${key}`}
                    defaultChecked={plan?.features[key] ?? false}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <h3 className="form-section-title">سقف استفاده</h3>
      <div className="form-grid">
        {limits.map(([key, label, max]) => (
          <label className="field" key={key}>
            <span className="label">{label}</span>
            <input
              className="input"
              name={`limit:${key}`}
              type="number"
              min={0}
              max={max}
              step={1}
              required
              defaultValue={plan?.limits[key] ?? 0}
            />
          </label>
        ))}
      </div>
      {plan && (
        <label className="feature-option section">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={plan.isActive}
          />
          <span>برای سازمان‌های جدید فعال باشد</span>
        </label>
      )}
    </>
  );
}

export function PlansManager({ plans }: { plans: Plan[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>, plan?: Plan) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim(),
        isActive: plan ? form.has("isActive") : true,
        ...values(form),
        ...(!plan
          ? {
              code: String(form.get("code") ?? "")
                .trim()
                .toLowerCase(),
            }
          : {}),
      };
      await apiRequest(
        plan ? `/api/platform/plans/${plan.id}` : "/api/platform/plans",
        { method: plan ? "PATCH" : "POST", body },
      );
      window.location.reload();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="section-header">
        <div>
          <h2>طرح‌های موجود</h2>
          <p>{plans.length.toLocaleString("fa-IR")} طرح ثبت‌شده</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setShowCreate(!showCreate);
            setEditing(null);
          }}
        >
          {showCreate ? "بستن فرم" : "＋ ساخت طرح"}
        </button>
      </div>
      {showCreate && (
        <section className="card card-pad section">
          <h2 className="card-title">طرح جدید</h2>
          <form onSubmit={(event) => void submit(event)}>
            <PlanFields />
            <div className="form-actions">
              <button className="btn btn-primary" disabled={busy} type="submit">
                ایجاد طرح
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                انصراف
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="grid plan-grid section">
        {plans.map((plan) => (
          <article className="card card-pad" key={plan.id}>
            <div className="section-header">
              <div>
                <h2>{plan.name}</h2>
                <p>{plan.description || plan.code}</p>
              </div>
              <span
                className={`badge ${plan.isActive ? "badge-green" : "badge-gray"}`}
              >
                {plan.isActive ? "فعال" : "غیرفعال"}
              </span>
            </div>
            <p className="muted">
              {Object.values(plan.features)
                .filter(Boolean)
                .length.toLocaleString("fa-IR")}{" "}
              قابلیت فعال · حداکثر{" "}
              {plan.limits.max_staff?.toLocaleString("fa-IR") ?? "۰"} کارمند
            </p>
            {editing === plan.id ? (
              <form onSubmit={(event) => void submit(event, plan)}>
                <PlanFields plan={plan} />
                <div className="form-actions">
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    type="submit"
                  >
                    ذخیره تغییرات
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setEditing(null)}
                  >
                    انصراف
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="btn btn-secondary btn-small"
                type="button"
                onClick={() => {
                  setEditing(plan.id);
                  setShowCreate(false);
                }}
              >
                ویرایش طرح
              </button>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
