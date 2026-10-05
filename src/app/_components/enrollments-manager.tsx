"use client";

import { useEffect, useState } from "react";
import { apiRequest, errorMessage } from "./api-client";
import {
  AdminButton,
  AdminDialog,
  ConfirmationDialog,
  StatusBadge,
} from "./admin-ui";

type Entry = {
  id: string;
  name: string;
  email: string;
  run_title: string;
  run_id: string;
  status: string;
  registered_at: string;
};

export function EnrollmentsManager({
  initial,
  canManage,
  runs,
}: {
  initial: Entry[];
  canManage: boolean;
  runs: Array<[string, string]>;
}) {
  const [entries, setEntries] = useState(initial);
  const [runId, setRunId] = useState("");
  const [registrationRunId, setRegistrationRunId] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const shown = entries.filter(
    (entry) =>
      (!runId || entry.run_id === runId) &&
      (!status || entry.status === status) &&
      (!search ||
        entry.email.toLowerCase().includes(search.toLowerCase()) ||
        entry.name.includes(search)),
  );

  async function refresh() {
    const result = await apiRequest<Entry[]>("/api/tenant/enrollments/manage");
    setEntries(result);
  }

  async function cancel(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/api/tenant/enrollments/manage/${id}/cancel`, {
        method: "POST",
        body: {},
      });
      await refresh();
      setMessage("ثبت‌نام لغو شد.");
      setCancelId(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registrationRunId) {
      setMessage("برنامه را انتخاب کنید.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/tenant/enrollments/manage", {
        method: "POST",
        body: {
          runId: registrationRunId,
          participantEmail: email,
          answers: {},
        },
      });
      await refresh();
      setMessage("شرکت‌کننده ثبت‌نام شد.");
      setEmail("");
      setRegistrationOpen(false);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-workspace">
      <div className="admin-metrics">
        {(
          [
            ["کل ثبت‌نام‌ها", entries.length],
            [
              "تأییدشده",
              entries.filter((entry) => entry.status === "CONFIRMED").length,
            ],
            [
              "در انتظار",
              entries.filter((entry) =>
                ["PENDING", "AWAITING_PAYMENT", "WAITLISTED"].includes(
                  entry.status,
                ),
              ).length,
            ],
            [
              "لغوشده",
              entries.filter((entry) => entry.status === "CANCELLED").length,
            ],
          ] as const
        ).map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{count.toLocaleString("fa-IR")}</strong>
          </div>
        ))}
      </div>
      <section className="admin-list-toolbar">
        <div className="admin-toolbar">
          <label>
            برنامه
            <select
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
            >
              <option value="">همه برنامه‌ها</option>
              {runs.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            وضعیت
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="CONFIRMED">تأیید شده</option>
              <option value="WAITLISTED">فهرست انتظار</option>
              <option value="CANCELLED">لغو شده</option>
            </select>
          </label>
          <label>
            نام یا ایمیل شرکت‌کننده
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <div className="admin-toolbar-actions">
          <a
            className="admin-action admin-action-neutral"
            href={`/api/tenant/enrollments/manage/export${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`}
          >
            دریافت CSV
          </a>
          {canManage && (
            <AdminButton
              type="button"
              tone="primary"
              icon="create"
              onClick={() => setRegistrationOpen(true)}
            >
              ثبت‌نام دستی
            </AdminButton>
          )}
        </div>
      </section>
      {canManage && (
        <AdminDialog
          open={registrationOpen}
          title="ثبت‌نام دستی"
          onClose={() => !busy && setRegistrationOpen(false)}
          description="شرکت‌کننده باید از قبل حساب فعال داشته باشد."
        >
          <p className="hint">
            شرکت‌کننده باید از قبل حساب فعال داشته باشد. برای برنامه‌هایی با فرم
            اختصاصی، ثبت‌نام از صفحه عمومی انجام شود.
          </p>
          <form
            id="manual-enrollment-form"
            onSubmit={register}
            className="form-grid"
          >
            <label>
              برنامه
              <select
                required
                value={registrationRunId}
                onChange={(event) => setRegistrationRunId(event.target.value)}
              >
                <option value="">انتخاب کنید</option>
                {runs.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ایمیل شرکت‌کننده
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <AdminButton type="submit" tone="primary" disabled={busy}>
              {busy ? "در حال ثبت‌نام..." : "ثبت‌نام"}
            </AdminButton>
          </form>
        </AdminDialog>
      )}
      <section className="card admin-data-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>فهرست ثبت‌نام‌ها</h2>
            <p>
              {shown.length.toLocaleString("fa-IR")} مورد بر اساس فیلترهای
              انتخاب‌شده
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="admin-table admin-card-table">
            <thead>
              <tr>
                <th>شرکت‌کننده</th>
                <th>برنامه</th>
                <th>وضعیت</th>
                <th>تاریخ ثبت‌نام</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="شرکت‌کننده">
                    <strong className="admin-primary-text">{entry.name}</strong>
                    <br />
                    <small dir="ltr">{entry.email}</small>
                  </td>
                  <td data-label="برنامه">{entry.run_title}</td>
                  <td data-label="وضعیت">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td data-label="تاریخ ثبت‌نام">
                    {new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
                      dateStyle: "medium",
                    }).format(new Date(entry.registered_at))}
                  </td>
                  <td data-label="عملیات">
                    {canManage && entry.status !== "CANCELLED" && (
                      <AdminButton
                        type="button"
                        tone="danger"
                        disabled={busy}
                        onClick={() => setCancelId(entry.id)}
                      >
                        لغو ثبت‌نام
                      </AdminButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="admin-empty-state">
            <strong>ثبت‌نامی پیدا نشد.</strong>
            <p>فیلترها را تغییر دهید یا ثبت‌نام دستی ایجاد کنید.</p>
          </div>
        )}
        {message && (
          <p role="status" className="admin-notice">
            {message}
          </p>
        )}
      </section>
      <ConfirmationDialog
        open={cancelId !== null}
        title="لغو ثبت‌نام"
        description={`آیا از لغو ثبت‌نام «${entries.find((entry) => entry.id === cancelId)?.name ?? ""}» در «${entries.find((entry) => entry.id === cancelId)?.run_title ?? ""}» اطمینان دارید؟`}
        busy={busy}
        onClose={() => setCancelId(null)}
        onConfirm={() => {
          if (cancelId) void cancel(cancelId);
        }}
        confirmText="لغو ثبت‌نام"
      />
    </div>
  );
}
