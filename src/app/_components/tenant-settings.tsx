"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, errorMessage } from "@/app/_components/api-client";

type Plan = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  features: Record<string, boolean>;
  limits: Record<string, number>;
};
type Details = {
  tenant: {
    id: string;
    slug: string;
    legalName: string;
    displayName: string;
    status: string;
    locale: string;
    timezone: string;
    plan: { id: string; code: string; name: string };
    createdAt: string;
    updatedAt: string;
  };
  database: { state: string; migrationVersion: string | null };
  features: Record<string, boolean>;
  featureOverrides: Record<string, boolean>;
  planFeatures: Record<string, boolean>;
  limits: Record<string, number>;
  limitOverrides: Record<string, number>;
  planLimits: Record<string, number>;
  branding: {
    brandName: string;
    logoAssetKey: string | null;
    primaryColor: string;
    accentColor: string;
  } | null;
  domains: Array<{
    id: string;
    hostname: string;
    type: string;
    isPrimary: boolean;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  provisioning: Array<{
    id: string;
    state: string;
    attemptCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    requestId: string;
    createdAt: string;
    updatedAt: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    actorId: string | null;
    requestId: string;
    createdAt: string;
  }>;
};

const featureNames: Record<string, string> = {
  public_website: "وب‌سایت عمومی",
  registration: "ثبت‌نام",
  waitlist: "فهرست انتظار",
  password_login: "ورود با رمز عبور",
  email_otp: "ورود با کد ایمیلی",
  courses: "دوره‌ها",
  events: "رویدادها",
  attendance: "حضور و غیاب",
  qr_attendance: "ثبت حضور با QR",
  payments: "پرداخت‌ها",
  certificates: "گواهی‌ها",
  quiz: "آزمون‌ها",
  assignments: "تکلیف‌ها",
  crm: "مدیریت ارتباط",
  sms: "پیامک",
  email: "ایمیل",
  ai: "هوش مصنوعی",
  custom_domain: "دامنهٔ اختصاصی",
  branches: "شعب",
};
const featureGroups = [
  {
    title: "آموزش و رویداد",
    keys: [
      "public_website",
      "courses",
      "events",
      "registration",
      "waitlist",
      "attendance",
      "qr_attendance",
      "certificates",
      "quiz",
      "assignments",
    ],
  },
  {
    title: "ارتباطات",
    keys: ["password_login", "email_otp", "crm", "sms", "email"],
  },
  {
    title: "سازمان و امکانات پیشرفته",
    keys: ["payments", "branches", "custom_domain", "ai"],
  },
];
const limitNames: Record<string, string> = {
  max_programs: "حداکثر برنامه‌ها",
  max_instructors: "حداکثر مربیان",
  max_staff: "حداکثر اعضای تیم",
  max_participants: "حداکثر شرکت‌کنندگان",
  max_active_runs: "رویدادهای فعال",
  max_storage_mb: "فضای ذخیره‌سازی (MB)",
  monthly_sms: "پیامک ماهانه",
  monthly_email: "ایمیل ماهانه",
  max_branches: "حداکثر شعب",
  max_custom_domains: "دامنه‌های اختصاصی",
};
const stateLabels: Record<string, string> = {
  REQUESTED: "در صف راه‌اندازی",
  DATABASE_CREATING: "ساخت پایگاه داده",
  MIGRATING: "اعمال تغییرات ساختاری",
  SEEDING: "افزودن داده‌های پایه",
  VERIFYING: "بررسی نهایی",
  ACTIVE: "آماده و فعال",
  FAILED_DATABASE: "خطا در ساخت پایگاه داده",
  FAILED_MIGRATION: "خطا در اعمال تغییرات",
  FAILED_SEED: "خطا در داده‌های پایه",
  FAILED_VERIFICATION: "بررسی نهایی ناموفق",
};

export function TenantSettings({
  initial,
  plans,
}: {
  initial: Details;
  plans: Plan[];
}) {
  const router = useRouter();
  const [details, setDetails] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [domain, setDomain] = useState("");
  const [verification, setVerification] = useState<{
    recordName: string;
    recordType: string;
    recordValue: string;
    expiresAt: string;
  } | null>(null);

  const isProvisioning = details.tenant.status === "PROVISIONING";
  useEffect(() => {
    if (!isProvisioning) return;
    const timer = window.setInterval(() => router.refresh(), 3500);
    return () => window.clearInterval(timer);
  }, [isProvisioning, router]);
  useEffect(() => {
    setDetails(initial);
  }, [initial]);

  async function action<T>(work: () => Promise<T>, message: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await work();
      setSuccess(message);
      router.refresh();
      return result;
    } catch (cause) {
      setError(errorMessage(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action(
      () =>
        apiRequest(`/api/platform/tenants/${details.tenant.id}`, {
          method: "PATCH",
          body: {
            legalName: form.get("legalName"),
            displayName: form.get("displayName"),
            locale: form.get("locale"),
            timezone: form.get("timezone"),
          },
        }),
      "اطلاعات سازمان ذخیره شد.",
    );
  }
  function handleBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action(
      () =>
        apiRequest(`/api/platform/tenants/${details.tenant.id}/branding`, {
          method: "PATCH",
          body: {
            brandName: form.get("brandName"),
            logoAssetKey: form.get("logoAssetKey") || null,
            primaryColor: form.get("primaryColor"),
            accentColor: form.get("accentColor"),
          },
        }),
      "تنظیمات برند ذخیره شد.",
    );
  }
  async function updateFeatures(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const overrides = Object.entries(featureNames)
      .map(([key]) => ({
        key,
        enabled: form.get(`feature:${key}`) === "on",
      }))
      .map((entry) => ({
        ...entry,
        enabled:
          entry.enabled === details.planFeatures[entry.key]
            ? null
            : entry.enabled,
      }));
    await action(
      () =>
        apiRequest(`/api/platform/tenants/${details.tenant.id}/features`, {
          method: "PATCH",
          body: { overrides },
        }),
      "قابلیت‌های سازمان به‌روزرسانی شد.",
    );
  }
  async function updateLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const overrides = Object.keys(limitNames)
      .map((key) => ({ key, value: Number(form.get(`limit:${key}`)) }))
      .map((entry) => ({
        ...entry,
        value:
          entry.value === details.planLimits[entry.key] ? null : entry.value,
      }));
    await action(
      () =>
        apiRequest(`/api/platform/tenants/${details.tenant.id}/limits`, {
          method: "PATCH",
          body: { overrides },
        }),
      "سقف‌های استفاده ذخیره شد.",
    );
  }
  async function updatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action(
      () =>
        apiRequest(`/api/platform/tenants/${details.tenant.id}/plan`, {
          method: "PATCH",
          body: { planCode: form.get("planCode") },
        }),
      "طرح سازمان تغییر کرد.",
    );
  }
  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action(
      () =>
        apiRequest<{
          domain: { hostname: string };
          verification: typeof verification;
        }>(`/api/platform/tenants/${details.tenant.id}/domains`, {
          method: "POST",
          body: { hostname: domain },
        }),
      "دامنه ثبت شد. رکورد DNS را برای تأیید اضافه کنید.",
    );
    if (result) {
      setVerification(result.verification);
      setDomain("");
    }
  }
  async function verifyDomain(domainId: string) {
    await action(
      () =>
        apiRequest(
          `/api/platform/tenants/${details.tenant.id}/domains/${domainId}/verify`,
          { method: "POST", body: {} },
        ),
      "دامنه با DNS تأیید شد.",
    );
  }

  const latestJob = details.provisioning[0];
  return (
    <>
      {(error || success) && (
        <p
          className={`alert ${error ? "alert-error" : "alert-success"}`}
          role={error ? "alert" : "status"}
        >
          {error || success}
        </p>
      )}
      {latestJob && (
        <section className="card card-pad section" aria-label="وضعیت راه‌اندازی">
          <div className="section-header">
            <div>
              <h2>راه‌اندازی پایگاه داده</h2>
              <p>مرحلهٔ فعلی، آخرین تلاش</p>
            </div>
            <span
              className={`badge ${latestJob.state === "ACTIVE" ? "badge-green" : latestJob.state.startsWith("FAILED_") ? "badge-red" : "badge-amber"}`}
            >
              {stateLabels[latestJob.state] ?? latestJob.state}
            </span>
          </div>
          <ol className="grid grid-4" aria-label="مراحل راه‌اندازی">
            {[
              "DATABASE_CREATING",
              "MIGRATING",
              "SEEDING",
              "VERIFYING",
              "ACTIVE",
            ].map((state, index) => (
              <li className="check-row" key={state}>
                <span className="check-label">
                  <span aria-hidden="true">
                    {latestJob.state === "ACTIVE" ||
                    [
                      "DATABASE_CREATING",
                      "MIGRATING",
                      "SEEDING",
                      "VERIFYING",
                    ].indexOf(latestJob.state) > index
                      ? "✓"
                      : "○"}
                  </span>
                  {stateLabels[state]}
                </span>
              </li>
            ))}
          </ol>
          {latestJob.errorMessage && (
            <p className="alert alert-error" role="status">
              {latestJob.errorMessage}{" "}
              <span className="table-sub">
                کد پیگیری: {latestJob.errorCode}
              </span>
            </p>
          )}
          <div className="form-actions">
            <span className="muted">
              تلاش {latestJob.attemptCount + 1} · شناسهٔ درخواست{" "}
              <code className="mono">{latestJob.requestId}</code>
            </span>
            {details.tenant.status === "FAILED" && (
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={busy}
                onClick={() =>
                  void action(
                    () =>
                      apiRequest(
                        `/api/platform/tenants/${details.tenant.id}/provisioning/retry`,
                        { method: "POST", body: {} },
                      ),
                    "راه‌اندازی دوباره در صف قرار گرفت.",
                  )
                }
              >
                تلاش دوباره
              </button>
            )}
          </div>
        </section>
      )}

      <div className="detail-grid section">
        <div className="detail-stack">
          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>مشخصات سازمان</h2>
                <p>شناسهٔ داخلی برای پنل استفاده نمی‌شود.</p>
              </div>
              <StatusBadge status={details.tenant.status} />
            </div>
            <form onSubmit={handleProfile}>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="displayName">
                    نام نمایشی
                  </label>
                  <input
                    className="input"
                    id="displayName"
                    name="displayName"
                    required
                    minLength={2}
                    defaultValue={details.tenant.displayName}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="legalName">
                    نام ثبتی
                  </label>
                  <input
                    className="input"
                    id="legalName"
                    name="legalName"
                    required
                    minLength={2}
                    defaultValue={details.tenant.legalName}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="locale">
                    زبان
                  </label>
                  <select
                    className="select"
                    id="locale"
                    name="locale"
                    defaultValue={details.tenant.locale}
                  >
                    <option value="fa-IR">فارسی</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="timezone">
                    منطقهٔ زمانی
                  </label>
                  <input
                    className="input mono"
                    id="timezone"
                    name="timezone"
                    dir="ltr"
                    required
                    defaultValue={details.tenant.timezone}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary btn-small"
                  disabled={busy}
                >
                  ذخیرهٔ مشخصات
                </button>
                {details.tenant.status === "ACTIVE" && (
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          apiRequest(
                            `/api/platform/tenants/${details.tenant.id}/status`,
                            { method: "PATCH", body: { status: "SUSPENDED" } },
                          ),
                        "سازمان معلق شد.",
                      )
                    }
                  >
                    تعلیق سازمان
                  </button>
                )}
                {details.tenant.status === "SUSPENDED" && (
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          apiRequest(
                            `/api/platform/tenants/${details.tenant.id}/status`,
                            { method: "PATCH", body: { status: "ACTIVE" } },
                          ),
                        "سازمان دوباره فعال شد.",
                      )
                    }
                  >
                    فعال‌سازی سازمان
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>قابلیت‌ها</h2>
                <p>مقادیر هر سازمان از طرح یا تنظیم اختصاصی آن می‌آید.</p>
              </div>
            </div>
            <form onSubmit={updateFeatures}>
              <div className="feature-groups">
                {featureGroups.map((group) => (
                  <fieldset className="permission-group" key={group.title}>
                    <legend className="permission-group-title">
                      {group.title}
                    </legend>
                    <div className="feature-grid">
                      {group.keys.map((key) => (
                        <label className="feature-option" key={key}>
                          <input
                            type="checkbox"
                            name={`feature:${key}`}
                            defaultChecked={details.features[key]}
                            aria-label={featureNames[key]}
                          />
                          <span>
                            {featureNames[key]}
                            {details.featureOverrides[key] !== undefined && (
                              <small className="muted"> · اختصاصی</small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary btn-small"
                  disabled={busy}
                >
                  ذخیرهٔ قابلیت‌ها
                </button>
              </div>
            </form>
          </section>

          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>محدودیت‌ها</h2>
                <p>سقف مجاز استفاده برای این سازمان</p>
              </div>
            </div>
            <form onSubmit={updateLimits}>
              <div className="form-grid">
                {Object.entries(limitNames).map(([key, label]) => (
                  <div className="field" key={key}>
                    <label className="label" htmlFor={`limit-${key}`}>
                      {label}
                      {details.limitOverrides[key] !== undefined && (
                        <small className="muted"> · اختصاصی</small>
                      )}
                    </label>
                    <input
                      className="input"
                      id={`limit-${key}`}
                      name={`limit:${key}`}
                      type="number"
                      min={0}
                      max={100000000}
                      step={1}
                      required
                      defaultValue={details.limits[key]}
                    />
                  </div>
                ))}
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary btn-small"
                  disabled={busy}
                >
                  ذخیرهٔ محدودیت‌ها
                </button>
              </div>
            </form>
          </section>

          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>هویت بصری</h2>
                <p>رنگ‌های پایه و نام برند سازمان</p>
              </div>
            </div>
            <form onSubmit={handleBranding}>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="brandName">
                    نام برند
                  </label>
                  <input
                    className="input"
                    id="brandName"
                    name="brandName"
                    required
                    minLength={2}
                    defaultValue={
                      details.branding?.brandName ?? details.tenant.displayName
                    }
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="logoAssetKey">
                    شناسهٔ فایل لوگو (اختیاری)
                  </label>
                  <input
                    className="input"
                    id="logoAssetKey"
                    name="logoAssetKey"
                    defaultValue={details.branding?.logoAssetKey ?? ""}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="primaryColor">
                    رنگ اصلی
                  </label>
                  <input
                    className="input mono"
                    id="primaryColor"
                    name="primaryColor"
                    pattern="#[0-9a-fA-F]{6}"
                    required
                    defaultValue={details.branding?.primaryColor ?? "#145D58"}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="accentColor">
                    رنگ تأکیدی
                  </label>
                  <input
                    className="input mono"
                    id="accentColor"
                    name="accentColor"
                    pattern="#[0-9a-fA-F]{6}"
                    required
                    defaultValue={details.branding?.accentColor ?? "#C99047"}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary btn-small"
                  disabled={busy}
                >
                  ذخیرهٔ برند
                </button>
              </div>
            </form>
          </section>
        </div>
        <aside className="detail-stack">
          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>طرح</h2>
                <p>طرح فعال برای سازمان</p>
              </div>
            </div>
            <form onSubmit={updatePlan}>
              <div className="field">
                <label className="label" htmlFor="planCode">
                  انتخاب طرح
                </label>
                <select
                  className="select"
                  id="planCode"
                  name="planCode"
                  defaultValue={details.tenant.plan.code}
                >
                  {plans
                    .filter((plan) => plan.isActive)
                    .map((plan) => (
                      <option key={plan.id} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                >
                  تغییر طرح
                </button>
              </div>
            </form>
            <hr className="divider" />
            <div className="check-row">
              <span className="muted">نام پایگاه داده</span>
              <code className="mono">
                {details.database.migrationVersion
                  ? details.database.state
                  : "در انتظار ایجاد"}
              </code>
            </div>
            <div className="check-row">
              <span className="muted">نسخهٔ ساختار</span>
              <code className="mono">
                {details.database.migrationVersion ?? "—"}
              </code>
            </div>
          </section>

          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>دامنه‌ها</h2>
                <p>فقط دامنهٔ تأییدشده برای مسیریابی معتبر است.</p>
              </div>
            </div>
            <div className="grid">
              {details.domains.map((item) => (
                <div className="check-row" key={item.id}>
                  <div>
                    <code className="mono">{item.hostname}</code>
                    <div className="hint">
                      {item.isPrimary ? "دامنهٔ اصلی" : "دامنهٔ اختصاصی"}
                    </div>
                  </div>
                  <div>
                    {item.verifiedAt ? (
                      <span className="badge badge-green">تأییدشده</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={busy}
                        onClick={() => void verifyDomain(item.id)}
                      >
                        بررسی DNS
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <form
              className="inline-form"
              onSubmit={addDomain}
              style={{ marginTop: 16 }}
            >
              <div className="field">
                <label className="label" htmlFor="custom-domain">
                  افزودن دامنهٔ اختصاصی
                </label>
                <input
                  className="input mono"
                  id="custom-domain"
                  dir="ltr"
                  placeholder="portal.example.com"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-small"
                disabled={busy}
              >
                ثبت دامنه
              </button>
            </form>
            {verification && (
              <div className="notice" style={{ marginTop: 13 }}>
                <strong>رکورد DNS برای تأیید</strong>
                <p>
                  یک TXT با نام{" "}
                  <code className="mono">{verification.recordName}</code> و
                  مقدار زیر اضافه کنید:
                </p>
                <code className="mono">{verification.recordValue}</code>
                <p className="hint">
                  اعتبار تا{" "}
                  {new Intl.DateTimeFormat("fa-IR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(verification.expiresAt))}
                </p>
              </div>
            )}
          </section>

          <section className="card card-pad">
            <div className="section-header">
              <div>
                <h2>گزارش ممیزی</h2>
                <p>آخرین تغییرات انجام‌شده</p>
              </div>
            </div>
            {details.audit.length ? (
              details.audit.slice(0, 8).map((item) => (
                <div className="check-row" key={item.id}>
                  <span>{item.action}</span>
                  <time className="hint" dateTime={item.createdAt}>
                    {new Intl.DateTimeFormat("fa-IR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(item.createdAt))}
                  </time>
                </div>
              ))
            ) : (
              <p className="empty">رویدادی ثبت نشده است.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "ACTIVE"
      ? "badge-green"
      : status === "FAILED" || status === "SUSPENDED"
        ? "badge-red"
        : "badge-amber";
  const labels: Record<string, string> = {
    ACTIVE: "فعال",
    SUSPENDED: "معلق",
    FAILED: "ناموفق",
    PROVISIONING: "در حال راه‌اندازی",
  };
  return <span className={`badge ${classes}`}>{labels[status] ?? status}</span>;
}
