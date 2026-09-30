"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatTenantDate,
  formatTenantWallInput,
  tenantWallTimeToUtc,
} from "@/modules/program-core/dates";
import { apiRequest, errorMessage } from "./api-client";
import { JalaliDateTimeInput } from "./jalali-datetime-input";

type Session = {
  id: string;
  run_id: string;
  title: string;
  run_title: string;
  program_title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  delivery_mode: string;
  venue_id: string | null;
  room_id: string | null;
  notes: string;
  room_name: string | null;
  venue_name: string | null;
  instructors: { id: string; name: string }[];
};
type Run = { id: string; title: string; capacity: number; state: string };
type Instructor = { id: string; name: string; status: string };
type Venue = {
  id: string;
  name: string;
  active: boolean;
  rooms: { id: string; name: string; capacity: number; active: boolean }[];
};
const value = (form: FormData, key: string) => String(form.get(key) ?? "");
const modeLabels: Record<string, string> = {
  IN_PERSON: "حضوری",
  ONLINE: "آنلاین",
  HYBRID: "ترکیبی",
};
const conflictMessage = (message: string) =>
  message.includes("INSTRUCTOR_SCHEDULE_CONFLICT")
    ? "این مدرس در بازه انتخاب‌شده جلسه دیگری دارد."
    : message.includes("ROOM_SCHEDULE_CONFLICT")
      ? "این کلاس در ساعت انتخاب‌شده رزرو شده است."
      : message.includes("ROOM_CAPACITY_CONFLICT")
        ? "ظرفیت کلاس از ظرفیت اجرا کمتر است."
        : message.includes("INVALID_SESSION_TIME")
          ? "زمان پایان باید پس از زمان شروع باشد."
          : message;

export function SessionsManager({
  timezone,
  canManage,
  canAssign,
}: {
  timezone: string;
  canManage: boolean;
  canAssign: boolean;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [venues, setVenues] = useState<Venue[]>([]),
    [instructors, setInstructors] = useState<Instructor[]>([]);
  const [showForm, setShowForm] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [venueId, setVenueId] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await apiRequest<Session[]>("/api/tenant/sessions"));
      if (canManage) {
        const [runRows, venueRows] = await Promise.all([
          apiRequest<Run[]>("/api/tenant/runs"),
          apiRequest<Venue[]>("/api/tenant/venues"),
        ]);
        setRuns(runRows);
        setVenues(venueRows);
        if (canAssign)
          setInstructors(
            await apiRequest<Instructor[]>("/api/tenant/identity/instructors"),
          );
      }
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [canManage, canAssign]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest(
        editing ? `/api/tenant/sessions/${editing.id}` : "/api/tenant/sessions",
        {
          method: editing ? "PUT" : "POST",
          body: {
            runId: value(data, "runId"),
            title: value(data, "title"),
            startsAt: tenantWallTimeToUtc(value(data, "startsAt"), timezone),
            endsAt: tenantWallTimeToUtc(value(data, "endsAt"), timezone),
            timezone,
            deliveryMode: value(data, "deliveryMode"),
            venueId: value(data, "venueId") || null,
            roomId: value(data, "roomId") || null,
            instructorIds: data.getAll("instructorIds").map(String),
            notes: value(data, "notes"),
          },
        },
      );
      setShowForm(false);
      setEditing(null);
      await refresh();
    } catch (cause) {
      setError(conflictMessage(errorMessage(cause)));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(item: Session) {
    if (!window.confirm(`جلسه «${item.title}» لغو شود؟`)) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/sessions/${item.id}/cancel`, {
        method: "POST",
      });
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const selectedVenue = venues.find((v) => v.id === venueId);
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">زمان‌بندی</div>
          <h1 className="page-title">جلسات</h1>
          <p className="page-description">
            جلسات برنامه‌های مجاز شما در منطقه زمانی {timezone}.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setVenueId("");
              setShowForm(true);
            }}
          >
            جلسه جدید
          </button>
        )}
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {showForm && (
        <section className="card card-pad section">
          <h2 className="card-title">
            {editing ? "ویرایش جلسه" : "جلسه جدید"}
          </h2>
          <form
            key={editing?.id ?? "new"}
            className="form-grid"
            onSubmit={save}
          >
            <label className="field">
              <span className="label">اجرا</span>
              {editing && (
                <input type="hidden" name="runId" value={editing.run_id} />
              )}
              <select
                className="select"
                name={editing ? undefined : "runId"}
                defaultValue={editing?.run_id}
                disabled={Boolean(editing)}
                required
              >
                {runs
                  .filter((r) => !["CANCELLED", "COMPLETED"].includes(r.state))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · ظرفیت {r.capacity}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="label">عنوان جلسه</span>
              <input
                className="input"
                name="title"
                required
                maxLength={200}
                defaultValue={editing?.title}
              />
            </label>
            <div className="field">
              <span className="label">شروع ({timezone})</span>
              <JalaliDateTimeInput
                name="startsAt"
                defaultValue={
                  editing
                    ? formatTenantWallInput(editing.starts_at, timezone)
                    : undefined
                }
                required
              />
            </div>
            <div className="field">
              <span className="label">پایان ({timezone})</span>
              <JalaliDateTimeInput
                name="endsAt"
                defaultValue={
                  editing
                    ? formatTenantWallInput(editing.ends_at, timezone)
                    : undefined
                }
                required
              />
            </div>
            <label className="field">
              <span className="label">شیوه برگزاری</span>
              <select
                name="deliveryMode"
                className="select"
                defaultValue={editing?.delivery_mode}
              >
                {Object.entries(modeLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">مکان</span>
              <select
                name="venueId"
                className="select"
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
              >
                <option value="">بدون مکان</option>
                {venues
                  .filter((v) => v.active)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="label">کلاس</span>
              <select
                name="roomId"
                className="select"
                defaultValue={editing?.room_id ?? ""}
              >
                <option value="">بدون کلاس</option>
                {selectedVenue?.rooms
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · ظرفیت {r.capacity}
                    </option>
                  ))}
              </select>
            </label>
            {canAssign && (
              <label className="field">
                <span className="label">مدرسان جلسه (خالی = مدرسان اجرا)</span>
                <select
                  name="instructorIds"
                  className="select"
                  multiple
                  size={Math.min(5, Math.max(2, instructors.length))}
                  defaultValue={editing?.instructors.map((i) => i.id) ?? []}
                >
                  {instructors
                    .filter((i) => i.status === "ACTIVE")
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="field field-full">
              <span className="label">یادداشت</span>
              <textarea
                className="textarea"
                name="notes"
                maxLength={5000}
                defaultValue={editing?.notes ?? ""}
              />
            </label>
            <div className="form-actions field-full">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {editing ? "ذخیره تغییرات" : "ثبت جلسه"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowForm(false)}
              >
                انصراف
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="card">
        {loading ? (
          <p className="card-pad">در حال بارگذاری…</p>
        ) : sessions.length === 0 ? (
          <p className="empty">هنوز جلسه‌ای برای شما ثبت نشده است.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>جلسه</th>
                  <th>زمان</th>
                  <th>مدرسان</th>
                  <th>مکان</th>
                  <th>روش</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      <span className="table-sub">
                        {item.program_title} · {item.run_title}
                      </span>
                    </td>
                    <td>
                      {formatTenantDate(item.starts_at, timezone)}
                      <br />
                      {formatTenantDate(item.ends_at, timezone)}
                    </td>
                    <td>
                      {item.instructors?.map((i) => i.name).join("، ") || "—"}
                    </td>
                    <td>{item.room_name ?? item.venue_name ?? "—"}</td>
                    <td>{modeLabels[item.delivery_mode]}</td>
                    <td>
                      <span className="badge badge-green">
                        {item.status === "SCHEDULED"
                          ? "برنامه‌ریزی‌شده"
                          : item.status === "CANCELLED"
                            ? "لغوشده"
                            : "تکمیل‌شده"}
                      </span>
                    </td>
                    <td>
                      {canManage && item.status === "SCHEDULED" && (
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing(item);
                            setVenueId(item.venue_id ?? "");
                            setShowForm(true);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          ویرایش
                        </button>
                      )}
                      {canManage && item.status === "SCHEDULED" && (
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          disabled={busy}
                          onClick={() => void cancel(item)}
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
        )}
      </section>
    </main>
  );
}
