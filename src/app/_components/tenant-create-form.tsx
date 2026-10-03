"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, errorMessage } from "@/app/_components/api-client";
import { suggestTenantSlug } from "@/modules/platform/tenants/slug";
import { provisioningStateLabels } from "@/modules/platform/tenants/provisioning-view";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  features: Record<string, boolean>;
  limits: Record<string, number>;
};
const features: Record<string, string> = {
  public_website: "وب‌سایت",
  registration: "ثبت‌نام",
  courses: "دوره‌ها",
  events: "رویدادها",
  attendance: "حضور و غیاب",
  payments: "پرداخت‌ها",
  certificates: "گواهی‌ها",
  custom_domain: "دامنه اختصاصی",
};
const limits: Record<string, string> = {
  max_staff: "کارکنان",
  max_participants: "شرکت‌کنندگان",
  max_programs: "برنامه‌ها",
  max_storage_mb: "فضا (مگابایت)",
};

export function TenantCreateForm({
  plans,
  platformDomain,
}: {
  plans: Plan[];
  platformDomain: string;
}) {
  const router = useRouter();
  const activePlans = plans.filter((plan) => plan.isActive);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [availability, setAvailability] = useState<
    "checking" | "available" | "taken" | "invalid"
  >("invalid");
  const [legalName, setLegalName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#145D58");
  const [logo, setLogo] = useState<File | null>(null);
  const [createdId, setCreatedId] = useState("");
  const [provisioningLabel, setProvisioningLabel] = useState("در صف راه‌اندازی");
  const [preset, setPreset] = useState<
    "SIMPLE" | "EDUCATIONAL" | "PROFESSIONAL"
  >("SIMPLE");
  const [planCode, setPlanCode] = useState(activePlans[0]?.code ?? "");
  const [featureOverrides, setFeatureOverrides] = useState<
    Record<string, boolean>
  >({});
  const [limitOverrides, setLimitOverrides] = useState<Record<string, number>>(
    {},
  );
  const [creationKey, setCreationKey] = useState("");
  const plan = activePlans.find((item) => item.code === planCode);

  useEffect(() => {
    const pending = sessionStorage.getItem("eventos-tenant-created-id");
    if (pending) {
      router.replace(`/platform/tenants/${pending}`);
      return;
    }
    const key =
      sessionStorage.getItem("eventos-tenant-creation-key") ??
      crypto.randomUUID();
    sessionStorage.setItem("eventos-tenant-creation-key", key);
    setCreationKey(key);
  }, [router]);
  useEffect(() => {
    if (!createdId) return;
    let finished = false;
    const check = async () => {
      if (finished) return;
      try {
        const details = await apiRequest<{
          tenant: { status: string };
          provisioning: Array<{ state: string }>;
        }>(`/api/platform/tenants/${createdId}`);
        const state = details.provisioning[0]?.state ?? "REQUESTED";
        setProvisioningLabel(
          provisioningStateLabels[state] ?? "راه‌اندازی کامل نشد",
        );
        if (details.tenant.status === "FAILED") {
          finished = true;
          setBusy(false);
          return;
        }
        if (details.tenant.status !== "ACTIVE") return;
        finished = true;
        if (logo) {
          const form = new FormData();
          form.set("file", logo);
          const response = await fetch(
            `/api/platform/tenants/${createdId}/logo`,
            {
              method: "POST",
              body: form,
              credentials: "same-origin",
            },
          );
          if (!response.ok) {
            setError(
              "مجموعه آماده است، اما بارگذاری لوگو انجام نشد. می‌توانید آن را در تنظیمات وب‌سایت اضافه کنید.",
            );
            setBusy(false);
            return;
          }
        }
        router.push(`/platform/tenants/${createdId}`);
        router.refresh();
      } catch (cause) {
        setError(errorMessage(cause));
        setBusy(false);
        finished = true;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2500);
    return () => {
      finished = true;
      window.clearInterval(timer);
    };
  }, [createdId, logo, router]);
  useEffect(() => {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
      setAvailability("invalid");
      return;
    }
    let cancelled = false;
    setAvailability("checking");
    const timer = window.setTimeout(() => {
      void apiRequest<{ available: boolean }>(
        `/api/platform/tenants/availability?slug=${encodeURIComponent(slug)}`,
      )
        .then((result) => {
          if (!cancelled)
            setAvailability(result.available ? "available" : "taken");
        })
        .catch(() => {
          if (!cancelled) setAvailability("invalid");
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug]);
  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step === 0 && availability !== "available") {
      setError("شناسهٔ مجموعه باید آزاد و معتبر باشد.");
      return;
    }
    setStep((value) => Math.min(value + 1, 3));
  }
  async function create() {
    if (busy || !creationKey || !plan) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ tenant: { id: string } }>(
        "/api/platform/tenants",
        {
          method: "POST",
          body: {
            creationKey,
            displayName,
            slug,
            legalName: legalName || undefined,
            ownerName,
            ownerEmail,
            primaryColor,
            preset,
            planCode,
            featureOverrides: Object.entries(featureOverrides).map(
              ([key, enabled]) => ({ key, enabled }),
            ),
            limitOverrides: Object.entries(limitOverrides).map(
              ([key, value]) => ({ key, value }),
            ),
          },
        },
      );
      sessionStorage.setItem("eventos-tenant-created-id", result.tenant.id);
      if (logo) {
        setCreatedId(result.tenant.id);
      } else {
        router.push(`/platform/tenants/${result.tenant.id}`);
        router.refresh();
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }
  return (
    <div className="tenant-wizard" dir="rtl">
      {createdId ? (
        <section className="card card-pad" role="status">
          <h2 className="card-title">{provisioningLabel}</h2>
          <p>مراحل واقعی راه‌اندازی در حال بررسی هستند.</p>
          {error && <p className="alert alert-error">{error}</p>}
          <a
            className="btn btn-secondary"
            href={`/platform/tenants/${createdId}`}
          >
            مشاهده وضعیت و تنظیمات
          </a>
        </section>
      ) : (
        <>
          <ol className="wizard-steps" aria-label="مراحل ایجاد مجموعه">
            {["اطلاعات اصلی", "ظاهر اولیه", "طرح", "بررسی و ایجاد"].map(
              (label, index) => (
                <li
                  key={label}
                  className={index === step ? "wizard-current" : ""}
                  aria-current={index === step ? "step" : undefined}
                >
                  {index + 1}. {label}
                </li>
              ),
            )}
          </ol>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          {step === 0 && (
            <form onSubmit={next}>
              <h2 className="card-title">اطلاعات اصلی</h2>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="tenant-display">
                    نام مجموعه
                  </label>
                  <input
                    className="input"
                    id="tenant-display"
                    required
                    minLength={2}
                    maxLength={120}
                    value={displayName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDisplayName(value);
                      if (!slugEdited) setSlug(suggestTenantSlug(value));
                    }}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tenant-slug">
                    شناسه / زیردامنه
                  </label>
                  <input
                    className="input mono"
                    id="tenant-slug"
                    dir="ltr"
                    required
                    minLength={2}
                    maxLength={63}
                    value={slug}
                    pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                    onChange={(event) => {
                      setSlugEdited(true);
                      setSlug(event.target.value.toLowerCase());
                    }}
                  />
                  <p className="hint" dir="ltr">
                    {slug || "…"}.{platformDomain}
                  </p>
                  <p className="hint" role="status">
                    {availability === "checking"
                      ? "در حال بررسی…"
                      : availability === "available"
                        ? "این آدرس آزاد است ✓"
                        : availability === "taken"
                          ? "این آدرس قبلاً ثبت شده است."
                          : "شناسه باید حروف انگلیسی کوچک، عدد یا خط تیره داشته باشد."}
                  </p>
                </div>
                <div className="field">
                  <label className="label" htmlFor="tenant-owner-name">
                    نام مدیر اصلی
                  </label>
                  <input
                    className="input"
                    id="tenant-owner-name"
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    value={ownerName}
                    onChange={(event) => setOwnerName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tenant-owner-email">
                    ایمیل مدیر اصلی
                  </label>
                  <input
                    className="input"
                    id="tenant-owner-email"
                    type="email"
                    dir="ltr"
                    required
                    maxLength={320}
                    autoComplete="email"
                    value={ownerEmail}
                    onChange={(event) => setOwnerEmail(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tenant-legal">
                    نام ثبتی (اختیاری)
                  </label>
                  <input
                    className="input"
                    id="tenant-legal"
                    minLength={2}
                    maxLength={200}
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={availability !== "available"}
                >
                  ادامه
                </button>
              </div>
            </form>
          )}
          {step === 1 && (
            <form onSubmit={next}>
              <h2 className="card-title">ظاهر اولیه</h2>
              <p className="muted">
                اگر لوگو انتخاب نکنید، نشان حرف اول نام مجموعه نمایش داده می‌شود.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="tenant-logo">
                    لوگو (اختیاری)
                  </label>
                  <input
                    className="input"
                    id="tenant-logo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      if (file && file.size > 5 * 1024 * 1024) {
                        setError("اندازهٔ لوگو باید کمتر از ۵ مگابایت باشد.");
                        setLogo(null);
                      } else {
                        setError("");
                        setLogo(file);
                      }
                    }}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tenant-color">
                    رنگ اصلی
                  </label>
                  <input
                    id="tenant-color"
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="tenant-preset">
                    سبک اولیه
                  </label>
                  <select
                    className="select"
                    id="tenant-preset"
                    value={preset}
                    onChange={(event) =>
                      setPreset(event.target.value as typeof preset)
                    }
                  >
                    <option value="SIMPLE">ساده</option>
                    <option value="EDUCATIONAL">آموزشی</option>
                    <option value="PROFESSIONAL">حرفه‌ای</option>
                  </select>
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit">
                  ادامه
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setStep(0)}
                >
                  بازگشت
                </button>
              </div>
            </form>
          )}
          {step === 2 && (
            <form onSubmit={next}>
              <h2 className="card-title">طرح مجموعه</h2>
              {!activePlans.length && (
                <p className="alert alert-error">
                  برای ایجاد مجموعه، ابتدا یک طرح فعال بسازید.
                </p>
              )}
              <div className="field">
                <label className="label" htmlFor="tenant-plan">
                  طرح
                </label>
                <select
                  className="select"
                  id="tenant-plan"
                  required
                  value={planCode}
                  onChange={(event) => {
                    setPlanCode(event.target.value);
                    setFeatureOverrides({});
                    setLimitOverrides({});
                  }}
                >
                  {activePlans.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              {plan && (
                <div className="notice">
                  <strong>{plan.name}</strong>
                  <p>{plan.description}</p>
                  <div className="wizard-summary-grid">
                    <div>
                      {Object.entries(features)
                        .filter(([key]) => plan.features[key])
                        .map(([key, name]) => (
                          <p key={key}>✓ {name}</p>
                        ))}
                    </div>
                    <div>
                      {Object.entries(limits)
                        .filter(([key]) => plan.limits[key] !== undefined)
                        .map(([key, name]) => (
                          <p key={key}>
                            {name}: {plan.limits[key]?.toLocaleString("fa-IR")}
                          </p>
                        ))}
                    </div>
                  </div>
                </div>
              )}
              {plan && (
                <details className="section">
                  <summary>تنظیمات پیشرفته</summary>
                  <p className="muted">
                    این تغییرات فقط برای همین مجموعه اعمال می‌شوند.
                  </p>
                  <div className="form-grid">
                    {Object.entries(features).map(([key, name]) => (
                      <label key={key} className="check-row">
                        <input
                          type="checkbox"
                          checked={
                            featureOverrides[key] ?? plan.features[key] ?? false
                          }
                          onChange={(event) =>
                            setFeatureOverrides((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                        />{" "}
                        {name}
                      </label>
                    ))}
                    {Object.entries(limits)
                      .filter(([key]) => plan.limits[key] !== undefined)
                      .map(([key, name]) => (
                        <div className="field" key={key}>
                          <label className="label" htmlFor={`limit-${key}`}>
                            {name}
                          </label>
                          <input
                            className="input"
                            id={`limit-${key}`}
                            type="number"
                            min="0"
                            max="100000000"
                            value={limitOverrides[key] ?? plan.limits[key]}
                            onChange={(event) =>
                              setLimitOverrides((current) => ({
                                ...current,
                                [key]: Number(event.target.value),
                              }))
                            }
                          />
                        </div>
                      ))}
                  </div>
                </details>
              )}
              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!plan}
                >
                  ادامه
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setStep(1)}
                >
                  بازگشت
                </button>
              </div>
            </form>
          )}
          {step === 3 && (
            <div>
              <h2 className="card-title">بررسی و ایجاد</h2>
              <dl className="wizard-review">
                <div>
                  <dt>مجموعه</dt>
                  <dd>{displayName}</dd>
                </div>
                <div>
                  <dt>آدرس</dt>
                  <dd dir="ltr">
                    {slug}.{platformDomain}
                  </dd>
                </div>
                <div>
                  <dt>مدیر</dt>
                  <dd>
                    {ownerName} · {ownerEmail}
                  </dd>
                </div>
                <div>
                  <dt>طرح</dt>
                  <dd>{plan?.name}</dd>
                </div>
                <div>
                  <dt>ظاهر</dt>
                  <dd>
                    <span
                      className="wizard-color"
                      style={{ backgroundColor: primaryColor }}
                    />{" "}
                    {preset === "SIMPLE"
                      ? "ساده"
                      : preset === "EDUCATIONAL"
                        ? "آموزشی"
                        : "حرفه‌ای"}{" "}
                    · {logo ? `لوگو: ${logo.name}` : "نشان حرف اول"}
                  </dd>
                </div>
              </dl>
              <p className="notice">
                پس از ثبت، آماده‌سازی در پس‌زمینه آغاز می‌شود و دعوت‌نامهٔ یک‌بارمصرف
                برای مدیر ارسال خواهد شد.
              </p>
              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || !creationKey}
                  onClick={() => void create()}
                >
                  {busy ? "در حال ثبت…" : "ایجاد مجموعه"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setStep(2)}
                >
                  بازگشت
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
