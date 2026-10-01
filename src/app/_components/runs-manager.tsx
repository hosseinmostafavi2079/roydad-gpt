"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  formatTenantDate,
  formatTenantWallInput,
  tenantWallTimeToUtc,
} from "@/modules/program-core/dates";
import { apiRequest, errorMessage } from "./api-client";
import { JalaliDateTimeInput } from "./jalali-datetime-input";

type Program = { id: string; title: string; status: string };
type Instructor = { id: string; name: string; status: string };
type Venue = { id: string; name: string; active: boolean };
type Run = {
  id: string;
  program_id: string;
  title: string;
  program_title: string;
  state: string;
  starts_at: string;
  ends_at: string;
  registration_starts_at: string | null;
  registration_ends_at: string | null;
  capacity: number;
  price_amount: string;
  price_currency: string;
  delivery_mode: string;
  minimum_capacity: number | null;
  waitlist_enabled: boolean;
  venue_id: string | null;
  notes: string;
  session_count: number;
  instructors: { id: string; name: string }[];
};
const value = (data: FormData, key: string) => String(data.get(key) ?? "");
const stateLabels: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  PRIVATE: "خصوصی",
  PUBLISHED: "منتشرشده",
  CANCELLED: "لغوشده",
  COMPLETED: "تکمیل‌شده",
};
const modeLabels: Record<string, string> = {
  IN_PERSON: "حضوری",
  ONLINE: "آنلاین",
  HYBRID: "ترکیبی",
};

export function RunsManager({
  timezone,
  canCreate,
  canEdit,
  canManage,
  canPublish,
  canAssign,
  registrationEnabled,
}: {
  timezone: string;
  canCreate: boolean;
  canEdit: boolean;
  canManage: boolean;
  canPublish: boolean;
  canAssign: boolean;
  registrationEnabled: boolean;
}) {
  const [runs, setRuns] = useState<Run[]>([]),
    [programs, setPrograms] = useState<Program[]>([]),
    [venues, setVenues] = useState<Venue[]>([]),
    [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [showForm, setShowForm] = useState(false),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<Run | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [runRows, programRows] = await Promise.all([
        apiRequest<Run[]>("/api/tenant/runs"),
        apiRequest<Program[]>("/api/tenant/programs"),
      ]);
      setRuns(runRows);
      setPrograms(programRows);
      if (canCreate || canEdit) {
        setVenues(await apiRequest<Venue[]>("/api/tenant/venues"));
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
  }, [canCreate, canEdit, canAssign]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const body = {
        programId: value(data, "programId"),
        title: value(data, "title"),
        startsAt: tenantWallTimeToUtc(value(data, "startsAt"), timezone),
        endsAt: tenantWallTimeToUtc(value(data, "endsAt"), timezone),
        registrationStartsAt: value(data, "registrationStartsAt")
          ? tenantWallTimeToUtc(value(data, "registrationStartsAt"), timezone)
          : null,
        registrationEndsAt: value(data, "registrationEndsAt")
          ? tenantWallTimeToUtc(value(data, "registrationEndsAt"), timezone)
          : null,
        deliveryMode: value(data, "deliveryMode"),
        capacity: Number(value(data, "capacity")),
        priceAmount: Number(value(data, "priceAmount")),
        priceCurrency: value(data, "priceCurrency") || "IRR",
        minimumCapacity: value(data, "minimumCapacity")
          ? Number(value(data, "minimumCapacity"))
          : null,
        waitlistEnabled: data.has("waitlistEnabled"),
        venueId: value(data, "venueId") || null,
        instructorIds: data.getAll("instructorIds").map(String),
        notes: value(data, "notes"),
      };
      await apiRequest(
        editing ? `/api/tenant/runs/${editing.id}` : "/api/tenant/runs",
        { method: editing ? "PUT" : "POST", body },
      );
      setShowForm(false);
      setEditing(null);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function transition(
    run: Run,
    state: "PRIVATE" | "PUBLISHED" | "CANCELLED" | "COMPLETED",
  ) {
    if (
      state === "CANCELLED" &&
      !window.confirm(`اجرای «${run.title}» لغو شود؟`)
    )
      return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/runs/${run.id}/state`, { body: { state } });
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">برنامه‌ریزی</div>
          <h1 className="page-title">اجراها</h1>
          <p className="page-description">
            زمان، ظرفیت و مدرسان هر اجرای برنامه را مشخص کنید.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            اجرای جدید
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
            {editing ? "ویرایش اجرا" : "اجرای جدید"}
          </h2>
          <form
            key={editing?.id ?? "new"}
            onSubmit={save}
            className="form-grid"
          >
            <label className="field">
              <span className="label">برنامه</span>
              {editing && (
                <input
                  type="hidden"
                  name="programId"
                  value={editing.program_id}
                />
              )}
              <select
                name={editing ? undefined : "programId"}
                className="select"
                defaultValue={editing?.program_id}
                disabled={Boolean(editing)}
                required
              >
                {programs
                  .filter((p) => p.status === "ACTIVE")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="label">عنوان اجرا</span>
              <input className="input" name="title" required maxLength={200} />
            </label>
            <div className="field">
              <span className="label">شروع اجرا ({timezone})</span>
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
              <span className="label">پایان اجرا ({timezone})</span>
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
            <div className="field">
              <span className="label">شروع ثبت‌نام</span>
              <JalaliDateTimeInput
                name="registrationStartsAt"
                defaultValue={
                  editing?.registration_starts_at
                    ? formatTenantWallInput(
                        editing.registration_starts_at,
                        timezone,
                      )
                    : undefined
                }
              />
            </div>
            <div className="field">
              <span className="label">پایان ثبت‌نام</span>
              <JalaliDateTimeInput
                name="registrationEndsAt"
                defaultValue={
                  editing?.registration_ends_at
                    ? formatTenantWallInput(
                        editing.registration_ends_at,
                        timezone,
                      )
                    : undefined
                }
              />
            </div>
            <label className="field">
              <span className="label">روش برگزاری</span>
              <select
                className="select"
                name="deliveryMode"
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
              <span className="label">حداکثر ظرفیت</span>
              <input
                className="input"
                type="number"
                min="1"
                max="100000"
                name="capacity"
                defaultValue={editing?.capacity}
                required
              />
            </label>
            <label className="field">
              <span className="label">حداقل ظرفیت (اختیاری)</span>
              <input
                className="input"
                type="number"
                min="1"
                name="minimumCapacity"
                defaultValue={editing?.minimum_capacity ?? ""}
              />
            </label>
            <label className="field">
              <span className="label">مبلغ ثبت‌نام (۰ برای رایگان)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                max="1000000000000"
                name="priceAmount"
                defaultValue={editing?.price_amount ?? "0"}
                required
              />
            </label>
            <label className="field">
              <span className="label">واحد پول</span>
              <input
                className="input"
                name="priceCurrency"
                maxLength={3}
                pattern="[A-Z]{3}"
                defaultValue={editing?.price_currency ?? "IRR"}
                required
              />
            </label>
            <label className="field">
              <span className="label">مکان پیش‌فرض</span>
              <select
                className="select"
                name="venueId"
                defaultValue={editing?.venue_id ?? ""}
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
            {canAssign && (
              <label className="field field-full">
                <span className="label">مدرسان (انتخاب چندتایی)</span>
                <select
                  className="select"
                  name="instructorIds"
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
            <label className="field field-full">
              <span>
                <input
                  type="checkbox"
                  name="waitlistEnabled"
                  defaultChecked={editing?.waitlist_enabled ?? false}
                />{" "}
                امکان فهرست انتظار
              </span>
            </label>
            <div className="form-actions field-full">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                ذخیره
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
        ) : runs.length === 0 ? (
          <p className="empty">هنوز اجرایی ثبت نشده است.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>اجرا</th>
                  <th>زمان</th>
                  <th>روش</th>
                  <th>مدرسان</th>
                  <th>جلسات</th>
                  <th>ظرفیت</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <strong>{run.title}</strong>
                      <span className="table-sub">{run.program_title}</span>
                    </td>
                    <td>
                      {formatTenantDate(run.starts_at, timezone)}
                      <br />
                      {formatTenantDate(run.ends_at, timezone)}
                    </td>
                    <td>{modeLabels[run.delivery_mode]}</td>
                    <td>
                      {run.instructors?.map((i) => i.name).join("، ") || "—"}
                    </td>
                    <td>{run.session_count}</td>
                    <td>{run.capacity}</td>
                    <td>
                      <span className="badge badge-green">
                        {stateLabels[run.state]}
                      </span>
                    </td>
                    <td>
                      {registrationEnabled && canEdit && (
                        <Link
                          className="btn btn-small btn-secondary"
                          href={`/runs/${run.id}/registration-form`}
                        >
                          فرم ثبت‌نام
                        </Link>
                      )}
                      {canEdit &&
                        !["CANCELLED", "COMPLETED"].includes(run.state) && (
                          <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            disabled={busy}
                            onClick={() => {
                              setEditing(run);
                              setShowForm(true);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            ویرایش
                          </button>
                        )}
                      {canManage && run.state === "DRAFT" && (
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          disabled={busy}
                          onClick={() => void transition(run, "PRIVATE")}
                        >
                          خصوصی
                        </button>
                      )}
                      {canPublish &&
                        ["DRAFT", "PRIVATE"].includes(run.state) && (
                          <button
                            type="button"
                            className="btn btn-small btn-primary"
                            disabled={busy}
                            onClick={() => void transition(run, "PUBLISHED")}
                          >
                            انتشار
                          </button>
                        )}
                      {canManage &&
                        ["DRAFT", "PRIVATE", "PUBLISHED"].includes(
                          run.state,
                        ) && (
                          <button
                            type="button"
                            className="btn btn-small btn-danger"
                            disabled={busy}
                            onClick={() => void transition(run, "CANCELLED")}
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
