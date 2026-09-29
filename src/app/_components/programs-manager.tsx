"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, errorMessage } from "./api-client";

type Program = {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
  short_description: string;
  description: string;
  category: string;
  level: string;
  objectives: string;
  prerequisites: string;
  intended_audience: string;
  default_duration_minutes: number | null;
  run_count: number;
};
const types: Record<string, string> = {
  COURSE: "دوره",
  WORKSHOP: "کارگاه",
  SEMINAR: "سمینار",
  WEBINAR: "وبینار",
  CONFERENCE: "همایش",
  BOOTCAMP: "بوت‌کمپ",
  PRIVATE_CLASS: "کلاس خصوصی",
  EXAM: "آزمون",
  MEETING: "نشست",
  EVENT: "رویداد",
};
const states: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  ACTIVE: "فعال",
  ARCHIVED: "بایگانی‌شده",
};
const value = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();

export function ProgramsManager({
  canCreate,
  canEdit,
  canPublish,
  canArchive,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canArchive: boolean;
}) {
  const [items, setItems] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Program | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(
        await apiRequest<Program[]>(
          `/api/tenant/programs?${new URLSearchParams({ search, type, status })}`,
        ),
      );
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [search, type, status]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const duration = value(form, "duration");
    const body = {
      type: value(form, "type"),
      title: value(form, "title"),
      slug: value(form, "slug"),
      shortDescription: value(form, "shortDescription"),
      description: value(form, "description"),
      category: value(form, "category"),
      level: value(form, "level"),
      objectives: value(form, "objectives"),
      prerequisites: value(form, "prerequisites"),
      intendedAudience: value(form, "intendedAudience"),
      defaultDurationMinutes: duration ? Number(duration) : null,
    };
    try {
      await apiRequest(
        editing ? `/api/tenant/programs/${editing.id}` : "/api/tenant/programs",
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
  async function changeState(item: Program, state: "ACTIVE" | "ARCHIVED") {
    if (state === "ARCHIVED" && !window.confirm(`«${item.title}» بایگانی شود؟`))
      return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/programs/${item.id}`, {
        method: "PATCH",
        body: { state },
      });
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const field = (
    name: string,
    label: string,
    kind: "text" | "textarea" | "number" = "text",
    full = false,
  ) => (
    <label
      className={`field ${full ? "field-full" : ""}`}
      htmlFor={name}
      key={name}
    >
      <span className="label">{label}</span>
      {kind === "textarea" ? (
        <textarea
          id={name}
          className="textarea"
          name={name}
          maxLength={5000}
          defaultValue={
            editing?.[
              (
                {
                  shortDescription: "short_description",
                  intendedAudience: "intended_audience",
                } as Record<string, keyof Program>
              )[name] ?? (name as keyof Program)
            ] ?? ""
          }
        />
      ) : (
        <input
          id={name}
          className="input"
          name={name}
          type={kind}
          min={kind === "number" ? 1 : undefined}
          required={name === "title" || name === "slug"}
          defaultValue={
            name === "duration"
              ? (editing?.default_duration_minutes ?? "")
              : (editing?.[
                  (
                    {
                      shortDescription: "short_description",
                      intendedAudience: "intended_audience",
                    } as Record<string, keyof Program>
                  )[name] ?? (name as keyof Program)
                ] ?? "")
          }
        />
      )}
    </label>
  );
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">محتوای آموزشی</div>
          <h1 className="page-title">دوره‌ها و رویدادها</h1>
          <p className="page-description">
            برنامه‌های قابل استفاده در اجراهای مختلف را مدیریت کنید.
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
            برنامه جدید
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
            {editing ? "ویرایش برنامه" : "برنامه جدید"}
          </h2>
          <form key={editing?.id ?? "new"} onSubmit={save}>
            <h3>۱. اطلاعات پایه</h3>
            <div className="form-grid">
              {field("title", "عنوان")}
              {field("slug", "شناسه لاتین")}
              <label className="field">
                <span className="label">نوع برنامه</span>
                <select
                  name="type"
                  className="select"
                  defaultValue={editing?.type ?? "COURSE"}
                >
                  {Object.entries(types).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {field("category", "دسته‌بندی")}
              {field("shortDescription", "توضیح کوتاه", "textarea", true)}
            </div>
            <h3>۲. محتوای آموزشی</h3>
            <div className="form-grid">
              {field("description", "توضیحات", "textarea", true)}
              {field("objectives", "اهداف", "textarea", true)}
              {field("prerequisites", "پیش‌نیازها", "textarea", true)}
              {field("intendedAudience", "مخاطبان", "textarea", true)}
            </div>
            <h3>۳. تنظیمات</h3>
            <div className="form-grid">
              {field("level", "سطح")}
              {field("duration", "مدت پیش‌فرض (دقیقه)", "number")}
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "در حال ذخیره…" : "ذخیره"}
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
        <div className="card-pad form-grid">
          <label className="field">
            <span className="label">جستجو</span>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="عنوان برنامه"
            />
          </label>
          <label className="field">
            <span className="label">نوع</span>
            <select
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">همه</option>
              {Object.entries(types).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">وضعیت</span>
            <select
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">همه</option>
              {Object.entries(states).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <p className="card-pad">در حال بارگذاری…</p>
        ) : items.length === 0 ? (
          <p className="empty">هنوز برنامه‌ای ثبت نشده است.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>عنوان</th>
                  <th>نوع</th>
                  <th>وضعیت</th>
                  <th>اجراها</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="table-name">{item.title}</span>
                      <span className="table-sub">{item.slug}</span>
                    </td>
                    <td>{types[item.type] ?? item.type}</td>
                    <td>
                      <span className="badge badge-green">
                        {states[item.status] ?? item.status}
                      </span>
                    </td>
                    <td>{item.run_count}</td>
                    <td>
                      {canEdit && item.status !== "ARCHIVED" && (
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          onClick={() => {
                            setEditing(item);
                            setShowForm(true);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          ویرایش
                        </button>
                      )}
                      {canPublish && item.status === "DRAFT" && (
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          disabled={busy}
                          onClick={() => void changeState(item, "ACTIVE")}
                        >
                          فعال‌سازی
                        </button>
                      )}
                      {canArchive && item.status !== "ARCHIVED" && (
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          disabled={busy}
                          onClick={() => void changeState(item, "ARCHIVED")}
                        >
                          بایگانی
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
