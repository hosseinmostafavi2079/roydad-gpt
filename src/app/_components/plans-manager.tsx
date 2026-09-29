"use client";

import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "@/app/_components/api-client";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  features: Record<string, boolean>;
  limits: Record<string, number>;
};

export function PlansManager({ plans }: { plans: Plan[] }) {
  const first = plans[0];
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [features, setFeatures] = useState(
    JSON.stringify(first?.features ?? {}, null, 2),
  );
  const [limits, setLimits] = useState(
    JSON.stringify(first?.limits ?? {}, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/api/platform/plans", {
        method: "POST",
        body: {
          code,
          name,
          description,
          isActive: true,
          features: JSON.parse(features),
          limits: JSON.parse(limits),
        },
      });
      window.location.reload();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  async function update(event: FormEvent<HTMLFormElement>, plan: Plan) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/platform/plans/${plan.id}`, {
        method: "PATCH",
        body: {
          name: form.get("name"),
          description: form.get("description"),
          isActive: form.get("isActive") === "on",
          features: JSON.parse(String(form.get("features"))),
          limits: JSON.parse(String(form.get("limits"))),
        },
      });
      setMessage(`طرح «${String(form.get("name"))}» به‌روزرسانی شد.`);
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
      {message && (
        <p className="alert alert-success" role="status">
          {message}
        </p>
      )}
      <div className="grid grid-2">
        {plans.map((plan) => (
          <article className="card card-pad" key={plan.id}>
            <div className="section-header">
              <div>
                <h2>{plan.name}</h2>
                <p>
                  <code className="mono">{plan.code}</code>
                </p>
              </div>
              <span
                className={`badge ${plan.isActive ? "badge-green" : "badge-gray"}`}
              >
                {plan.isActive ? "فعال" : "غیرفعال"}
              </span>
            </div>
            <form onSubmit={(event) => void update(event, plan)}>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor={`plan-name-${plan.id}`}>
                    نام طرح
                  </label>
                  <input
                    className="input"
                    id={`plan-name-${plan.id}`}
                    name="name"
                    required
                    defaultValue={plan.name}
                  />
                </div>
                <div className="field">
                  <label
                    className="label"
                    htmlFor={`plan-description-${plan.id}`}
                  >
                    توضیحات
                  </label>
                  <input
                    className="input"
                    id={`plan-description-${plan.id}`}
                    name="description"
                    defaultValue={plan.description}
                  />
                </div>
                <div className="field field-full">
                  <label className="label" htmlFor={`plan-features-${plan.id}`}>
                    قابلیت‌ها (JSON)
                  </label>
                  <textarea
                    className="textarea mono"
                    id={`plan-features-${plan.id}`}
                    name="features"
                    dir="ltr"
                    required
                    defaultValue={JSON.stringify(plan.features, null, 2)}
                  />
                </div>
                <div className="field field-full">
                  <label className="label" htmlFor={`plan-limits-${plan.id}`}>
                    محدودیت‌ها (JSON)
                  </label>
                  <textarea
                    className="textarea mono"
                    id={`plan-limits-${plan.id}`}
                    name="limits"
                    dir="ltr"
                    required
                    defaultValue={JSON.stringify(plan.limits, null, 2)}
                  />
                </div>
              </div>
              <label className="check-label" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={plan.isActive}
                />{" "}
                این طرح برای سازمان‌های جدید فعال باشد
              </label>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                >
                  ذخیرهٔ تغییرات طرح
                </button>
              </div>
            </form>
          </article>
        ))}
      </div>
      <section className="section card card-pad">
        <div className="section-header">
          <div>
            <h2>ساخت طرح</h2>
            <p>ویژگی‌ها و سقف‌ها باید با قالب JSON کامل وارد شوند.</p>
          </div>
        </div>
        <form onSubmit={(event) => void create(event)}>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="new-plan-name">
                نام
              </label>
              <input
                className="input"
                id="new-plan-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="new-plan-code">
                کد انگلیسی
              </label>
              <input
                className="input mono"
                id="new-plan-code"
                dir="ltr"
                required
                pattern="[a-z][a-z0-9_]{1,47}"
                value={code}
                onChange={(event) => setCode(event.target.value.toLowerCase())}
              />
            </div>
            <div className="field field-full">
              <label className="label" htmlFor="new-plan-description">
                توضیحات
              </label>
              <input
                className="input"
                id="new-plan-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="new-plan-features">
                قابلیت‌ها (JSON)
              </label>
              <textarea
                className="textarea mono"
                id="new-plan-features"
                dir="ltr"
                required
                value={features}
                onChange={(event) => setFeatures(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="new-plan-limits">
                محدودیت‌ها (JSON)
              </label>
              <textarea
                className="textarea mono"
                id="new-plan-limits"
                dir="ltr"
                required
                value={limits}
                onChange={(event) => setLimits(event.target.value)}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              ایجاد طرح
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
