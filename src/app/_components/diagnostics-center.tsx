"use client";
import { useEffect, useRef, useState } from "react";
import type { DiagnosticsRepository } from "@/modules/platform/diagnostics/repository";
import { incidentListSchema } from "@/modules/platform/diagnostics/schema";
import { AdminButton, AdminDialog } from "./admin-ui";

type Serialized<T> = {
  [K in keyof T]: T[K] extends Date | null ? string | null : T[K];
};
export type Incident = Serialized<
  Awaited<ReturnType<DiagnosticsRepository["getIncident"]>>
>;
export type DiagnosticEvent = Serialized<
  Awaited<ReturnType<DiagnosticsRepository["listDiagnosticEvents"]>>[number]
>;
type Summary = Awaited<
  ReturnType<DiagnosticsRepository["getDiagnosticsSummary"]>
>;
type Tenant = { id: string; displayName: string };
export const healthLabels: Record<string, [string, string]> = {
  HEALTHY: ["سالم", "success"],
  DEGRADED: ["نیازمند بررسی", "warning"],
  UNAVAILABLE: ["در دسترس نیست", "danger"],
  UNKNOWN: ["وضعیت نامشخص", "neutral"],
};
export const severityLabels: Record<string, [string, string]> = {
  INFO: ["اطلاع", "info"],
  WARNING: ["هشدار", "warning"],
  ERROR: ["خطا", "danger"],
  CRITICAL: ["بحرانی", "danger"],
};
export const statusLabels: Record<string, [string, string]> = {
  OPEN: ["باز", "warning"],
  RECOVERED: ["برطرف‌شده", "success"],
};
const components: Record<string, string> = {
  APPLICATION: "برنامه",
  CONTROL_DATABASE: "پایگاه داده کنترل",
  MAIN_WORKER: "پردازشگر اصلی",
  BACKUP_RUNNER: "اجرای بکاپ",
  BACKUP_SYSTEM: "سامانه بکاپ",
  TENANT_PROVISIONING: "راه‌اندازی سازمان",
  PAYMENTS: "پرداخت‌ها",
  SMS: "پیامک",
};
const emptyFilters = {
  status: "",
  severity: "",
  component: "",
  tenantId: "",
  incidentRef: "",
  requestId: "",
  from: "",
  to: "",
};
const pageSize = 25;
const errorText = "دریافت اطلاعات عیب‌یابی با مشکل مواجه شد. دوباره تلاش کنید.";
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tehran",
      }).format(new Date(value))
    : "—";
const number = (value: string | number) =>
  new Intl.NumberFormat("fa-IR").format(BigInt(value));
function Badge({
  value,
  labels,
}: {
  value: string;
  labels: Record<string, [string, string]>;
}) {
  const [label, tone] = labels[value] ?? ["وضعیت نامشخص", "neutral"];
  return <span className={`admin-status admin-status-${tone}`}>{label}</span>;
}
async function api<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/platform/diagnostics/${path}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Diagnostics unavailable");
  return (await response.json()).data;
}
export function exportFilename(header: string | null) {
  const match = header?.match(
    /filename="(eventos-incident-INC-[0-9]{8}-[A-F0-9]{32}\.json)"/,
  );
  return match?.[1] ?? "eventos-incident-report.json";
}
function IncidentFields({
  incident,
  tenant,
}: {
  incident: Incident;
  tenant: string;
}) {
  return (
    <dl className="diagnostic-fields">
      <div>
        <dt>بخش</dt>
        <dd>{components[incident.component] ?? "بخش دیگر"}</dd>
      </div>
      <div>
        <dt>سازمان</dt>
        <dd>{tenant}</dd>
      </div>
      <div>
        <dt>اولین مشاهده</dt>
        <dd>{date(incident.firstSeenAt)}</dd>
      </div>
      <div>
        <dt>آخرین مشاهده</dt>
        <dd>{date(incident.lastSeenAt)}</dd>
      </div>
      <div>
        <dt>دفعات تکرار</dt>
        <dd>{number(incident.occurrenceCount)}</dd>
      </div>
      <div>
        <dt>آخرین Request ID</dt>
        <dd dir="ltr">{incident.latestRequestId ?? "—"}</dd>
      </div>
    </dl>
  );
}
function EventCards({
  events,
  tenantName,
}: {
  events: DiagnosticEvent[];
  tenantName: (id: string | null) => string;
}) {
  return (
    <div className="diagnostic-events">
      {events.map((event) => (
        <article className="diagnostic-event" key={event.id}>
          <div className="diagnostic-actions">
            <Badge value={event.severity} labels={severityLabels} />
            <time>{date(event.occurredAt)}</time>
          </div>
          <p>{event.message}</p>
          <dl className="diagnostic-fields">
            <div>
              <dt>بخش</dt>
              <dd>{components[event.component] ?? "بخش دیگر"}</dd>
            </div>
            <div>
              <dt>سازمان</dt>
              <dd>{tenantName(event.tenantId)}</dd>
            </div>
            <div>
              <dt>کد رویداد</dt>
              <dd dir="ltr">{event.eventCode}</dd>
            </div>
            <div>
              <dt>Incident ID</dt>
              <dd dir="ltr">{event.incidentId ?? "—"}</dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd dir="ltr">{event.requestId ?? "—"}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function DiagnosticsCenter() {
  const [summary, setSummary] = useState<Summary | null>(null),
    [open, setOpen] = useState<Incident[]>([]),
    [incidents, setIncidents] = useState<Incident[]>([]),
    [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [filters, setFilters] = useState(emptyFilters),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [eventOffset, setEventOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filterError, setFilterError] = useState(""),
    [tenants, setTenants] = useState<Tenant[]>([]);
  const [detail, setDetail] = useState<Incident | null>(null),
    [detailEvents, setDetailEvents] = useState<DiagnosticEvent[]>([]),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const [exporting, setExporting] = useState(false),
    [exportMessage, setExportMessage] = useState("");
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/platform/tenants?page=1&pageSize=100", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((result) => {
        if (!controller.signal.aborted) setTenants(result.data.items);
      })
      .catch(() => {
        /* UUID fallback remains usable when mapping is unavailable. */
      });
    return () => controller.abort();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the explicit manual reload generation.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void Promise.allSettled([
      api<Summary>("summary", controller.signal),
      api<Incident[]>(
        "incidents?status=OPEN&limit=5&offset=0",
        controller.signal,
      ),
      api<Incident[]>(
        `incidents?limit=${pageSize}&offset=${offset}${query ? `&${query}` : ""}`,
        controller.signal,
      ),
      api<DiagnosticEvent[]>(
        `events?limit=${pageSize}&offset=${eventOffset}`,
        controller.signal,
      ),
    ]).then((result) => {
      if (controller.signal.aborted) return;
      const [health, active, list, recent] = result;
      if (health?.status === "fulfilled") setSummary(health.value);
      if (active?.status === "fulfilled") setOpen(active.value);
      if (list?.status === "fulfilled") setIncidents(list.value);
      if (recent?.status === "fulfilled") setEvents(recent.value);
      if (result.some((value) => value.status === "rejected"))
        setError(errorText);
      setLoading(false);
    });
    return () => controller.abort();
  }, [query, offset, eventOffset, refresh]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  const tenantName = (id: string | null) =>
    id
      ? (tenants.find((value) => value.id === id)?.displayName ??
        `سازمان ${id}`)
      : "کل پلتفرم";
  async function showDetail(id: string) {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetail(null);
    setDetailEvents([]);
    setDetailError("");
    setExportMessage("");
    setDetailLoading(true);
    try {
      const [incident, recent] = await Promise.all([
        api<Incident>(`incidents/${encodeURIComponent(id)}`, controller.signal),
        api<DiagnosticEvent[]>(
          `events?incidentId=${encodeURIComponent(id)}&limit=25&offset=0`,
          controller.signal,
        ),
      ]);
      if (!controller.signal.aborted) {
        setDetail(incident);
        setDetailEvents(recent);
      }
    } catch {
      if (!controller.signal.aborted) setDetailError(errorText);
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }
  function closeDetail() {
    detailRequest.current?.abort();
    setDetail(null);
    setDetailLoading(false);
    setDetailError("");
  }
  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      params.set(
        key,
        key === "from" || key === "to"
          ? `${value}T${key === "from" ? "00:00:00" : "23:59:59"}+03:30`
          : value.trim(),
      );
    }
    if (!incidentListSchema.safeParse(Object.fromEntries(params)).success) {
      setFilterError(
        "شناسه‌ها و بازه زمانی را بررسی کنید؛ بازه حداکثر ۳۱ روز است.",
      );
      return;
    }
    setFilterError("");
    setOffset(0);
    setQuery(params.toString());
  }
  async function download() {
    if (!detail) return;
    setExporting(true);
    setExportMessage("");
    try {
      const response = await fetch(
        `/api/platform/diagnostics/incidents/${encodeURIComponent(detail.id)}/export`,
        { cache: "no-store" },
      );
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(
        response.headers.get("content-disposition"),
      );
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage("گزارش امن برای دریافت آماده شد.");
    } catch {
      setExportMessage("دریافت گزارش ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <main className="content diagnostics-center" dir="rtl">
      <div className="page-heading">
        <div>
          <div className="eyebrow">مدیریت پلتفرم</div>
          <h1 className="page-title">عیب‌یابی و سلامت سیستم</h1>
          <p className="page-description">
            مشاهده وضعیت، پیگیری رخدادها و راهنمای بررسی
          </p>
        </div>
        <AdminButton
          disabled={loading}
          onClick={() => {
            setRefresh((value) => value + 1);
            if (detail) void showDetail(detail.id);
          }}
        >
          بروزرسانی
        </AdminButton>
      </div>
      {error && (
        <p className="diagnostic-notice diagnostic-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">در حال دریافت اطلاعات عیب‌یابی...</p>}
      <section aria-labelledby="diagnostic-health-title">
        <h2 id="diagnostic-health-title">وضعیت کلی سیستم</h2>
        <div className="diagnostic-health">
          {summary?.components.map((value) => (
            <article
              className="card diagnostic-health-card"
              key={value.component}
            >
              <h3>{components[value.component] ?? "بخش دیگر"}</h3>
              <Badge value={value.status} labels={healthLabels} />
              {["MAIN_WORKER", "BACKUP_RUNNER"].includes(value.component) && (
                <p className="hint">
                  بر اساس آخرین مشاهده؛ زمان مشاهده در پاسخ موجود نیست.
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
      <section
        className="card card-pad"
        aria-labelledby="diagnostic-open-title"
      >
        <div className="diagnostic-actions">
          <h2 id="diagnostic-open-title">رخدادهای باز اخیر</h2>
          <span className="hint">حداکثر ۵ مورد اخیر؛ تعداد کل نیست</span>
        </div>
        {!loading && !error && open.length === 0 ? (
          <p className="empty">در حال حاضر رخداد بازی ثبت نشده است.</p>
        ) : (
          <div className="diagnostic-open">
            {open.map((incident) => (
              <article key={incident.id}>
                <Badge value={incident.severity} labels={severityLabels} />
                <h3>{incident.summary}</h3>
                <p className="hint">
                  {components[incident.component]} ·{" "}
                  {tenantName(incident.tenantId)}
                </p>
                <AdminButton
                  onClick={() => {
                    void showDetail(incident.id);
                  }}
                  aria-label={`بررسی ${incident.incidentRef}`}
                >
                  بررسی رخداد
                </AdminButton>
              </article>
            ))}
          </div>
        )}
      </section>
      <section
        className="card card-pad"
        aria-labelledby="diagnostic-history-title"
      >
        <h2 id="diagnostic-history-title">آخرین رخدادها</h2>
        <form
          className="diagnostic-filters"
          onSubmit={applyFilters}
          aria-label="جستجو و فیلتر رخدادها"
        >
          {(
            [
              ["status", "وضعیت", statusLabels],
              ["severity", "شدت", severityLabels],
              [
                "component",
                "بخش",
                Object.fromEntries(
                  Object.entries(components).map(([key, value]) => [
                    key,
                    [value, "neutral"],
                  ]),
                ),
              ],
            ] as [
              "status" | "severity" | "component",
              string,
              Record<string, [string, string]>,
            ][]
          ).map(([key, label, options]) => (
            <div key={key}>
              <label className="label" htmlFor={`diag-${key}`}>
                {label}
              </label>
              <select
                className="select"
                id={`diag-${key}`}
                value={filters[key]}
                onChange={(event) =>
                  setFilters({ ...filters, [key]: event.target.value })
                }
              >
                <option value="">همه</option>
                {Object.entries(options).map(([value, [text]]) => (
                  <option value={value} key={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <label className="label" htmlFor="diag-tenant">
              سازمان
            </label>
            <select
              id="diag-tenant"
              className="select"
              value={filters.tenantId}
              onChange={(event) =>
                setFilters({ ...filters, tenantId: event.target.value })
              }
            >
              <option value="">همه سازمان‌ها</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.displayName}
                </option>
              ))}
            </select>
            <span className="hint">فهرست محدود به ۱۰۰ سازمان نخست</span>
          </div>
          {(
            [
              ["incidentRef", "Incident ID"],
              ["requestId", "Request ID"],
              ["from", "از تاریخ"],
              ["to", "تا تاریخ"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="label" htmlFor={`diag-${key}`}>
                {label}
              </label>
              <input
                className="input"
                id={`diag-${key}`}
                dir="ltr"
                type={key === "from" || key === "to" ? "date" : "text"}
                maxLength={key === "incidentRef" ? 45 : 36}
                value={filters[key]}
                onChange={(event) =>
                  setFilters({ ...filters, [key]: event.target.value })
                }
              />
            </div>
          ))}
          <div className="diagnostic-actions diagnostic-filter-actions">
            <AdminButton type="submit" tone="primary">
              اعمال فیلترها
            </AdminButton>
            <AdminButton
              type="button"
              onClick={() => {
                setFilters(emptyFilters);
                setQuery("");
                setOffset(0);
                setFilterError("");
              }}
            >
              پاک کردن فیلترها
            </AdminButton>
          </div>
        </form>
        {filterError && (
          <p role="alert" className="diagnostic-error">
            {filterError}
          </p>
        )}
        {!loading && !error && incidents.length === 0 ? (
          <p className="empty">رخدادی مطابق فیلترها پیدا نشد.</p>
        ) : (
          <div className="diagnostic-history">
            {incidents.map((incident) => (
              <article className="diagnostic-incident" key={incident.id}>
                <div className="diagnostic-actions">
                  <span className="diagnostic-code" dir="ltr">
                    {incident.incidentRef}
                  </span>
                  <div className="diagnostic-actions">
                    <Badge value={incident.status} labels={statusLabels} />
                    <Badge value={incident.severity} labels={severityLabels} />
                  </div>
                </div>
                <h3>{incident.summary}</h3>
                <IncidentFields
                  incident={incident}
                  tenant={tenantName(incident.tenantId)}
                />
                <AdminButton
                  icon="view"
                  aria-label={`جزئیات ${incident.incidentRef}`}
                  onClick={() => {
                    void showDetail(incident.id);
                  }}
                >
                  جزئیات رخداد
                </AdminButton>
              </article>
            ))}
          </div>
        )}
        <div className="diagnostic-actions diagnostic-pagination">
          <AdminButton
            disabled={loading || offset === 0}
            onClick={() => setOffset((value) => value - pageSize)}
          >
            رخدادهای قبلی
          </AdminButton>
          <span>صفحه {number(offset / pageSize + 1)}</span>
          <AdminButton
            disabled={loading || incidents.length < pageSize || offset >= 9975}
            onClick={() => setOffset((value) => value + pageSize)}
          >
            رخدادهای بعدی
          </AdminButton>
        </div>
      </section>
      <section
        className="card card-pad diagnostic-technical"
        aria-labelledby="diagnostic-events-title"
      >
        <h2 id="diagnostic-events-title">رویدادهای فنی اخیر</h2>
        <p className="hint">اطلاعات امن ثبت‌شده؛ زمان‌ها به وقت تهران</p>
        {!loading && !error && events.length === 0 ? (
          <p className="empty">رویداد فنی جدیدی ثبت نشده است.</p>
        ) : (
          <EventCards events={events} tenantName={tenantName} />
        )}
        <div className="diagnostic-actions diagnostic-pagination">
          <AdminButton
            disabled={loading || eventOffset === 0}
            onClick={() => setEventOffset((value) => value - pageSize)}
          >
            رویدادهای قبلی
          </AdminButton>
          <span>صفحه {number(eventOffset / pageSize + 1)}</span>
          <AdminButton
            disabled={
              loading || events.length < pageSize || eventOffset >= 9975
            }
            onClick={() => setEventOffset((value) => value + pageSize)}
          >
            رویدادهای بعدی
          </AdminButton>
        </div>
      </section>
      <p className="hint">
        این صفحه فقط برای مشاهده است. اطلاعات با دکمه بروزرسانی تازه می‌شوند.
      </p>
      <AdminDialog
        open={detail !== null || detailLoading || !!detailError}
        title="جزئیات رخداد"
        onClose={closeDetail}
        wide
        footer={
          detail && (
            <AdminButton
              tone="primary"
              disabled={exporting}
              onClick={() => {
                void download();
              }}
            >
              {exporting ? "در حال دریافت..." : "دریافت گزارش عیب‌یابی"}
            </AdminButton>
          )
        }
      >
        {detailLoading && <p role="status">در حال دریافت جزئیات...</p>}
        {detailError && <p role="alert">{detailError}</p>}
        {detail && (
          <div className="diagnostic-detail">
            <div className="diagnostic-actions">
              <strong className="diagnostic-code" dir="ltr">
                {detail.incidentRef}
              </strong>
              <Badge value={detail.status} labels={statusLabels} />
              <Badge value={detail.severity} labels={severityLabels} />
            </div>
            <h3>{detail.summary}</h3>
            <IncidentFields
              incident={detail}
              tenant={tenantName(detail.tenantId)}
            />
            <p>زمان برطرف شدن: {date(detail.recoveredAt)}</p>
            <h3>علت احتمالی</h3>
            <p>{detail.probableCause ?? "علت مشخصی ثبت نشده است."}</p>
            <h3>پیشنهاد بررسی</h3>
            <ol>
              {detail.troubleshooting.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ol>
            <h3>رویدادهای مرتبط اخیر</h3>
            <EventCards events={detailEvents} tenantName={tenantName} />
            {detailEvents.length === 0 && <p>رویداد مرتبطی ثبت نشده است.</p>}
            <p className="hint">حداکثر ۲۵ رویداد مرتبط نمایش داده می‌شود.</p>
            {exportMessage && <p role="status">{exportMessage}</p>}
          </div>
        )}
      </AdminDialog>
    </main>
  );
}
