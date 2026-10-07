"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackupRepository,
  safeBackupJob,
} from "@/modules/platform/backups/repository";
import {
  type BackupPolicy,
  type BackupState,
  backupPolicySchema,
} from "@/modules/platform/backups/schema";
import { AdminButton, AdminDialog, ConfirmationDialog } from "./admin-ui";

type Serialized<T> = {
  [K in keyof T]: T[K] extends Date | null ? string | null : T[K];
};
export type BackupJob = Serialized<ReturnType<typeof safeBackupJob>>;
type Policy = Serialized<Awaited<ReturnType<BackupRepository["policy"]>>>;
type Tenant = { id: string; displayName: string };
export const backupStates: Record<BackupState, [string, string]> = {
  QUEUED: ["در صف", "info"],
  RUNNING: ["در حال اجرا", "info"],
  VERIFYING: ["در حال بررسی", "warning"],
  SUCCEEDED: ["موفق", "success"],
  FAILED: ["ناموفق", "danger"],
  PRUNED: ["حذف‌شده طبق سیاست نگهداری", "neutral"],
};
export const hasActiveBackups = (jobs: BackupJob[]) =>
  jobs.some((job) => ["QUEUED", "RUNNING", "VERIFYING"].includes(job.state));
const pageSize = 25;
const weekdays = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
  "شنبه",
];
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tehran",
      }).format(new Date(value))
    : "—";
const size = (value: string | null) =>
  value == null
    ? "—"
    : `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(Number(value) / 1048576)} مگابایت`;
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) throw new Error("Backup request unavailable");
  return (await response.json()).data;
}
function Badge({ state }: { state: BackupState }) {
  const [label, tone] = backupStates[state];
  return <span className={`admin-status admin-status-${tone}`}>{label}</span>;
}
function JobStatus({ job }: { job: BackupJob }) {
  const active = hasActiveBackups([job]);
  const delayed =
    job.state === "QUEUED" &&
    Date.now() - Date.parse(job.createdAt ?? "") > 120_000;
  const text: Record<BackupState, string> = {
    QUEUED: "در انتظار شروع سرویس بکاپ",
    RUNNING: "در حال تهیه نسخه پشتیبان...",
    VERIFYING: "در حال بررسی فایل‌ها و صحت Checksum...",
    SUCCEEDED: "بکاپ با موفقیت تکمیل شد.",
    FAILED: job.errorMessage ?? "اجرای بکاپ ناموفق بود.",
    PRUNED: "طبق سیاست نگهداری حذف شده است.",
  };
  return (
    <div
      className={`backup-job-status${delayed ? " backup-job-delayed" : ""}`}
      role="status"
    >
      <p>
        {active && <span className="backup-spinner" aria-hidden="true" />}
        {text[job.state]}
      </p>
      {job.state === "QUEUED" && (
        <>
          {delayed && (
            <p>این درخواست هنوز توسط سرویس اجرای بکاپ دریافت نشده است.</p>
          )}
          <small>
            در حالت عادی سرویس بکاپ حداکثر هر ۱۵ دقیقه صف را بررسی می‌کند.
          </small>
        </>
      )}
    </div>
  );
}
function JobFields({ job, tenant }: { job: BackupJob; tenant: string }) {
  return (
    <dl className="backup-details">
      <div>
        <dt>نوع</dt>
        <dd>{job.scope === "FULL_PLATFORM" ? "کامل پلتفرم" : "یک سازمان"}</dd>
      </div>
      <div>
        <dt>سازمان</dt>
        <dd>{tenant}</dd>
      </div>
      <div>
        <dt>نحوه اجرا</dt>
        <dd>{job.triggerType === "SCHEDULED" ? "خودکار" : "دستی"}</dd>
      </div>
      <div>
        <dt>درخواست‌کننده</dt>
        <dd>در API موجود نیست</dd>
      </div>
      <div>
        <dt>زمان ایجاد</dt>
        <dd>{date(job.createdAt)}</dd>
      </div>
      <div>
        <dt>شروع</dt>
        <dd>{date(job.startedAt)}</dd>
      </div>
      <div>
        <dt>پایان</dt>
        <dd>{date(job.completedAt)}</dd>
      </div>
      <div>
        <dt>حجم</dt>
        <dd>{size(job.sizeBytes)}</dd>
      </div>
      <div>
        <dt>صحت Checksum</dt>
        <dd>{job.checksumVerified ? "تأیید شده" : "تأیید نشده"}</dd>
      </div>
      <div>
        <dt>Request ID</dt>
        <dd className="backup-code" dir="ltr">
          {job.requestId}
        </dd>
      </div>
    </dl>
  );
}

export function BackupCenter() {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [offset, setOffset] = useState(0);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState<BackupPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"FULL_PLATFORM" | "TENANT" | null>(
    null,
  );
  const [detail, setDetail] = useState<BackupJob | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [search, setSearch] = useState("");
  const [tenantPage, setTenantPage] = useState(1);
  const [tenantPages, setTenantPages] = useState(1);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState("");
  const names = useRef(new Map<string, string>());
  const listRequest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    setRefreshing(true);
    try {
      const result = await api<BackupJob[]>(
        `/api/platform/backups?limit=${pageSize}&offset=${offset}`,
      );
      if (request !== listRequest.current) return;
      setJobs(result);
      setError("");
      setDetail((current) =>
        current
          ? (result.find((job) => job.id === current.id) ?? current)
          : null,
      );
    } catch {
      if (request === listRequest.current)
        setError("دریافت وضعیت بکاپ با مشکل مواجه شد. دوباره تلاش کنید.");
    } finally {
      if (request === listRequest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [offset]);
  useEffect(() => {
    void refresh();
    return () => {
      ++listRequest.current;
    };
  }, [refresh]);
  const loadPolicy = useCallback(async () => {
    try {
      const value = await api<Policy>("/api/platform/backups/policy");
      setPolicy(value);
      setForm({
        enabled: value.enabled,
        scope: value.scope,
        frequency: value.frequency,
        executionTime: value.executionTime,
        weekday: value.weekday,
        timezone: value.timezone,
        retentionCount: value.retentionCount,
      });
    } catch {
      setError("دریافت تنظیمات بکاپ با مشکل مواجه شد. دوباره تلاش کنید.");
    }
  }, []);
  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);
  useEffect(() => {
    const controller = new AbortController();
    setTenantLoading(true);
    const timer = setTimeout(() => {
      void api<{ items: Tenant[]; pageCount: number }>(
        `/api/platform/tenants?page=${tenantPage}&pageSize=20&search=${encodeURIComponent(search)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setTenants(result.items);
          setTenantPages(result.pageCount);
          setTenantError("");
          for (const tenant of result.items)
            names.current.set(tenant.id, tenant.displayName);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setTenantError("دریافت سازمان‌ها ممکن نشد. دوباره جست‌وجو کنید.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setTenantLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, tenantPage]);
  const active = hasActiveBackups(jobs);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!active || refreshing || !visible) return;
    const timer = setTimeout(() => {
      void refresh();
    }, 7500);
    return () => clearTimeout(timer);
  }, [active, refreshing, refresh, visible]);
  const tenantName = (job: BackupJob) =>
    job.tenantId
      ? (names.current.get(job.tenantId) ?? "سازمان خارج از فهرست فعلی")
      : "همه سازمان‌ها";
  async function enqueue() {
    if (!confirm || (confirm === "TENANT" && !selectedTenant)) return;
    setBusy(true);
    setMessage("");
    try {
      const job = await api<BackupJob>("/api/platform/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          confirm === "TENANT"
            ? { scope: confirm, tenantId: selectedTenant?.id }
            : { scope: confirm },
        ),
      });
      setOffset(0);
      setJobs((current) =>
        [job, ...current.filter((value) => value.id !== job.id)].slice(
          0,
          pageSize,
        ),
      );
      setConfirm(null);
      setError("");
      setMessage("درخواست بکاپ ثبت شد و در صف اجرا قرار گرفت.");
    } catch {
      setError("ثبت درخواست بکاپ ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  async function savePolicy(event: React.FormEvent) {
    event.preventDefault();
    const parsed = backupPolicySchema.safeParse(form);
    if (!parsed.success) {
      setMessage("");
      setError(
        "تنظیمات را بررسی کنید؛ تعداد نسخه‌ها باید عدد صحیح بین ۱ و ۱۰۰ باشد.",
      );
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await api<Policy>("/api/platform/backups/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      setPolicy(result);
      setError("");
      setMessage("تنظیمات ذخیره شد؛ ذخیره تنظیمات بکاپی اجرا نمی‌کند.");
    } catch {
      setError("ذخیره تنظیمات ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  }
  async function openDetail(job: BackupJob) {
    try {
      setDetail(
        await api<BackupJob>(
          `/api/platform/backups/${encodeURIComponent(job.id)}`,
        ),
      );
    } catch {
      setError("دریافت جزئیات بکاپ ممکن نشد. دوباره تلاش کنید.");
    }
  }
  const completed = [...jobs].sort((a, b) =>
    (b.completedAt ?? "").localeCompare(a.completedAt ?? ""),
  );
  const successful = completed.find((job) => job.state === "SUCCEEDED");
  const failed = completed.find((job) => job.state === "FAILED");
  return (
    <main className="content backup-center" dir="rtl">
      <div className="page-heading">
        <div>
          <div className="eyebrow">مدیریت پلتفرم</div>
          <h1 className="page-title">پشتیبان‌گیری</h1>
          <p className="page-description">
            تهیه نسخه پشتیبان، زمان‌بندی و پیگیری وضعیت اجرا
          </p>
        </div>
        <AdminButton
          disabled={refreshing}
          onClick={() => {
            void refresh();
            if (!form) void loadPolicy();
          }}
        >
          {" "}
          {refreshing ? "در حال دریافت..." : "تازه‌سازی وضعیت"}
        </AdminButton>
      </div>
      {error && (
        <p className="backup-notice backup-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="backup-notice" role="status">
          {message}
        </p>
      )}
      <section aria-label="وضعیت کلی" className="backup-summary">
        {[
          [
            "آخرین بکاپ موفق در این صفحه",
            successful ? date(successful.completedAt) : "هنوز موردی ثبت نشده",
          ],
          [
            "آخرین بکاپ ناموفق در این صفحه",
            failed ? date(failed.completedAt) : "موردی وجود ندارد",
          ],
          [
            "بکاپ بعدی",
            policy
              ? policy.enabled
                ? date(policy.nextRunAt)
                : "بکاپ خودکار غیرفعال است"
              : "تنظیمات دریافت نشده",
          ],
          [
            "تعداد نسخه‌های نگهداری",
            policy
              ? new Intl.NumberFormat("fa-IR").format(policy.retentionCount)
              : "—",
          ],
        ].map(([label, value]) => (
          <div className="card backup-summary-card" key={label}>
            <span className="muted">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <div className="backup-settings">
        <section
          className="card card-pad"
          aria-labelledby="backup-manual-title"
        >
          <h2 id="backup-manual-title">بکاپ دستی</h2>
          <p className="muted">
            درخواست در صف قرار می‌گیرد و توسط فرآیند عملیاتی اجرا می‌شود.
          </p>
          <div className="backup-manual-block">
            <h3>بکاپ کامل پلتفرم</h3>
            <p className="hint">پایگاه‌های داده و رسانه‌های تحت پوشش بکاپ کامل</p>
            <AdminButton
              tone="primary"
              disabled={busy}
              onClick={() => setConfirm("FULL_PLATFORM")}
            >
              تهیه بکاپ کامل
            </AdminButton>
          </div>
          <div className="backup-manual-block">
            <h3>بکاپ یک سازمان</h3>
            <label className="label" htmlFor="backup-search">
              جست‌وجوی سازمان
            </label>
            <input
              id="backup-search"
              className="input"
              value={search}
              maxLength={80}
              placeholder="نام یا شناسه سازمان"
              onChange={(event) => {
                setSearch(event.target.value);
                setTenantPage(1);
              }}
            />
            {tenantError && <p role="alert">{tenantError}</p>}
            <label className="label" htmlFor="backup-tenant">
              سازمان
            </label>
            <select
              id="backup-tenant"
              className="select"
              value={selectedTenant?.id ?? ""}
              disabled={tenantLoading}
              onChange={(event) =>
                setSelectedTenant(
                  tenants.find((tenant) => tenant.id === event.target.value) ??
                    null,
                )
              }
            >
              <option value="">
                {tenantLoading
                  ? "در حال دریافت سازمان‌ها..."
                  : "یک سازمان انتخاب کنید"}
              </option>
              {selectedTenant &&
                !tenants.some((tenant) => tenant.id === selectedTenant.id) && (
                  <option value={selectedTenant.id}>
                    {selectedTenant.displayName}
                  </option>
                )}
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.displayName}
                </option>
              ))}
            </select>
            {tenantPages > 1 && (
              <div className="backup-actions">
                <AdminButton
                  disabled={tenantPage === 1 || tenantLoading}
                  onClick={() => setTenantPage((value) => value - 1)}
                >
                  سازمان‌های قبلی
                </AdminButton>
                <span>
                  {tenantPage} / {tenantPages}
                </span>
                <AdminButton
                  disabled={tenantPage >= tenantPages || tenantLoading}
                  onClick={() => setTenantPage((value) => value + 1)}
                >
                  سازمان‌های بعدی
                </AdminButton>
              </div>
            )}
            <AdminButton
              tone="primary"
              disabled={!selectedTenant || busy}
              onClick={() => setConfirm("TENANT")}
            >
              تهیه بکاپ سازمان
            </AdminButton>
          </div>
        </section>
        <section
          className="card card-pad"
          aria-labelledby="backup-policy-title"
        >
          <h2 id="backup-policy-title">بکاپ خودکار</h2>
          {!form ? (
            <p role="status">تنظیمات هنوز دریافت نشده است.</p>
          ) : (
            <form onSubmit={savePolicy} className="backup-policy-form">
              <label className="backup-toggle">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={saving}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                فعال بودن بکاپ خودکار
              </label>
              <div className="backup-form-grid">
                <div>
                  <label className="label" htmlFor="backup-frequency">
                    تکرار
                  </label>
                  <select
                    id="backup-frequency"
                    className="select"
                    disabled={saving}
                    value={form.frequency}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        frequency: event.target
                          .value as BackupPolicy["frequency"],
                        weekday: event.target.value === "WEEKLY" ? 6 : null,
                      })
                    }
                  >
                    <option value="DAILY">روزانه</option>
                    <option value="WEEKLY">هفتگی</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="backup-time">
                    زمان اجرا
                  </label>
                  <input
                    id="backup-time"
                    type="time"
                    className="input"
                    required
                    disabled={saving}
                    value={form.executionTime}
                    onChange={(event) =>
                      setForm({ ...form, executionTime: event.target.value })
                    }
                  />
                </div>
                {form.frequency === "WEEKLY" && (
                  <div>
                    <label className="label" htmlFor="backup-weekday">
                      روز هفته
                    </label>
                    <select
                      id="backup-weekday"
                      className="select"
                      disabled={saving}
                      value={form.weekday ?? 6}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          weekday: Number(event.target.value),
                        })
                      }
                    >
                      {weekdays.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="backup-timezone">
                    منطقه زمانی
                  </label>
                  <select
                    id="backup-timezone"
                    className="select"
                    disabled={saving}
                    value={form.timezone}
                    onChange={(event) =>
                      setForm({ ...form, timezone: event.target.value })
                    }
                  >
                    {Array.from(
                      new Set([
                        form.timezone,
                        "Asia/Tehran",
                        "UTC",
                        "Europe/London",
                        "America/New_York",
                      ]),
                    ).map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="backup-retention">
                    تعداد نسخه‌های نگهداری
                  </label>
                  <input
                    id="backup-retention"
                    className="input"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    required
                    disabled={saving}
                    value={
                      Number.isNaN(form.retentionCount)
                        ? ""
                        : form.retentionCount
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        retentionCount: event.target.valueAsNumber,
                      })
                    }
                  />
                </div>
              </div>
              <p className="hint">
                فقط آخرین{" "}
                {Number.isNaN(form.retentionCount) ? "N" : form.retentionCount}{" "}
                نسخه موفق نگهداری می‌شود.
              </p>
              <p className="hint">
                اجرای بعدی:{" "}
                {policy?.enabled ? date(policy.nextRunAt) : "غیرفعال"} · زمان
                اجرا بر اساس منطقه زمانی انتخاب‌شده است.
              </p>
              <AdminButton type="submit" tone="primary" disabled={saving}>
                {saving ? "در حال ذخیره..." : "ذخیره تنظیمات"}
              </AdminButton>
            </form>
          )}
        </section>
      </div>
      <section
        className="card card-pad"
        aria-labelledby="backup-history-title"
        aria-busy={refreshing}
      >
        <div className="backup-actions">
          <h2 id="backup-history-title">تاریخچه بکاپ‌ها</h2>
          <span className="hint">
            نمایش حداکثر ۲۵ مورد · زمان‌ها به وقت تهران
          </span>
        </div>
        {loading ? (
          <p role="status">در حال دریافت تاریخچه...</p>
        ) : jobs.length === 0 ? (
          <p className="empty">هنوز بکاپی در این صفحه وجود ندارد.</p>
        ) : (
          <div className="backup-history">
            {jobs.map((job) => (
              <article className="backup-job" key={job.id}>
                <div className="backup-actions">
                  <Badge state={job.state} />
                  <AdminButton
                    icon="view"
                    onClick={() => {
                      void openDetail(job);
                    }}
                    aria-label={`جزئیات بکاپ ${job.requestId}`}
                  >
                    جزئیات
                  </AdminButton>
                </div>
                <JobStatus job={job} />
                <JobFields job={job} tenant={tenantName(job)} />
              </article>
            ))}
          </div>
        )}
        <div className="backup-actions backup-pagination">
          <AdminButton
            disabled={offset === 0 || refreshing}
            onClick={() => setOffset((value) => value - pageSize)}
          >
            صفحه قبل
          </AdminButton>
          <span>
            صفحه {new Intl.NumberFormat("fa-IR").format(offset / pageSize + 1)}
          </span>
          <AdminButton
            disabled={jobs.length < pageSize || offset >= 9975 || refreshing}
            onClick={() => setOffset((value) => value + pageSize)}
          >
            صفحه بعد
          </AdminButton>
        </div>
        <p className="hint">
          {active
            ? "وضعیت درخواست‌های فعال هر چند ثانیه تازه می‌شود."
            : "برای دریافت آخرین وضعیت از تازه‌سازی استفاده کنید."}
        </p>
      </section>
      <p className="backup-note">
        بازیابی بکاپ در حال حاضر فقط از طریق فرآیند عملیاتی کنترل‌شده انجام
        می‌شود.
      </p>
      <ConfirmationDialog
        open={confirm !== null}
        title={
          confirm === "TENANT"
            ? `تهیه بکاپ ${selectedTenant?.displayName ?? "سازمان"}`
            : "تهیه بکاپ کامل پلتفرم"
        }
        description="این اقدام یک درخواست در صف ایجاد می‌کند. اجرا ممکن است زمان‌بر باشد؛ می‌توانید صفحه را با خیال راحت تازه کنید."
        confirmText="ثبت درخواست بکاپ"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          void enqueue();
        }}
      />
      <AdminDialog
        open={detail !== null}
        title="جزئیات بکاپ"
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <Badge state={detail.state} />
            <JobStatus job={detail} />
            <JobFields job={detail} tenant={tenantName(detail)} />
            {detail.state === "FAILED" && (
              <div className="backup-notice backup-error">
                <p>{detail.errorMessage ?? "اجرای بکاپ ناموفق بود."}</p>
                {detail.errorCode && <code>{detail.errorCode}</code>}
              </div>
            )}
          </>
        )}
      </AdminDialog>
    </main>
  );
}
