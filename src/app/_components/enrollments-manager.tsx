"use client";

import { useState } from "react";
import { apiRequest, errorMessage } from "./api-client";

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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
    if (!window.confirm("این ثبت‌نام لغو شود؟")) return;
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/api/tenant/enrollments/manage/${id}/cancel`, {
        method: "POST",
        body: {},
      });
      await refresh();
      setMessage("ثبت‌نام لغو شد.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runId) {
      setMessage("برنامه را انتخاب کنید.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/tenant/enrollments/manage", {
        method: "POST",
        body: { runId, participantEmail: email, answers: {} },
      });
      await refresh();
      setMessage("شرکت‌کننده ثبت‌نام شد.");
      setEmail("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card card-pad">
        <div className="form-grid">
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
        <a
          className="button button-secondary"
          href={`/api/tenant/enrollments/manage/export${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`}
        >
          دریافت CSV
        </a>
      </section>
      {canManage && (
        <section className="card card-pad">
          <h2 className="card-title">ثبت‌نام دستی</h2>
          <p className="hint">
            شرکت‌کننده باید از قبل حساب فعال داشته باشد. برای برنامه‌هایی با فرم
            اختصاصی، ثبت‌نام از صفحه عمومی انجام شود.
          </p>
          <form onSubmit={register} className="form-grid">
            <label>
              برنامه
              <select
                required
                value={runId}
                onChange={(event) => setRunId(event.target.value)}
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
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              ثبت‌نام
            </button>
          </form>
        </section>
      )}
      <section className="card card-pad">
        <div className="table-wrap">
          <table>
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
                  <td>
                    {entry.name}
                    <br />
                    <small dir="ltr">{entry.email}</small>
                  </td>
                  <td>{entry.run_title}</td>
                  <td>
                    {entry.status === "CONFIRMED"
                      ? "تأیید شده"
                      : entry.status === "WAITLISTED"
                        ? "فهرست انتظار"
                        : "لغو شده"}
                  </td>
                  <td>
                    {new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
                      dateStyle: "medium",
                    }).format(new Date(entry.registered_at))}
                  </td>
                  <td>
                    {canManage && entry.status !== "CANCELLED" && (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => cancel(entry.id)}
                      >
                        لغو
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="hint">ثبت‌نامی پیدا نشد.</p>}
        <p role="status">{message}</p>
      </section>
    </div>
  );
}
