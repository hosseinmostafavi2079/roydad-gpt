"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTenantDate } from "@/modules/program-core/dates";
import { apiRequest, errorMessage } from "./api-client";

type Session = {
  id: string;
  title: string;
  program_title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  delivery_mode: string;
  venue_id: string | null;
  venue_name: string | null;
  instructors: { id: string; name: string }[];
};
type DateParts = {
  year: string;
  month: string;
  day: string;
  monthName: string;
  weekday: string;
};
const weekdays = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
];
const englishWeek = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
function parts(date: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const rows = formatter.formatToParts(date);
  const get = (type: string) =>
    rows.find((row) => row.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: new Intl.DateTimeFormat("en-US-u-ca-persian", {
      timeZone: timezone,
      month: "numeric",
    }).format(date),
    day: get("day"),
    monthName: get("month"),
    weekday: get("weekday"),
  };
}

export function CalendarManager({ timezone }: { timezone: string }) {
  const [items, setItems] = useState<Session[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(() => new Date()),
    [view, setView] = useState<"month" | "agenda">("month");
  const [instructor, setInstructor] = useState(""),
    [program, setProgram] = useState(""),
    [venue, setVenue] = useState(""),
    [mode, setMode] = useState("");
  useEffect(() => {
    let active = true;
    void apiRequest<Session[]>("/api/tenant/sessions")
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const anchorParts = parts(anchor, timezone);
  const days = useMemo(() => {
    const unique = new Map<string, { day: string; weekday: string }>();
    for (let offset = -45; offset <= 45; offset++) {
      const date = new Date(anchor.getTime() + offset * 86_400_000);
      const item = parts(date, timezone);
      if (item.year === anchorParts.year && item.month === anchorParts.month)
        unique.set(item.day, { day: item.day, weekday: item.weekday });
    }
    return [...unique.values()].sort((a, b) => Number(a.day) - Number(b.day));
  }, [anchor, timezone, anchorParts.year, anchorParts.month]);
  const filtered = items.filter(
    (item) =>
      (!instructor || item.instructors?.some((i) => i.id === instructor)) &&
      (!program || item.program_title === program) &&
      (!venue || item.venue_id === venue) &&
      (!mode || item.delivery_mode === mode) &&
      item.status === "SCHEDULED",
  );
  const byDay = new Map<string, Session[]>();
  for (const item of filtered) {
    const key = parts(new Date(item.starts_at), timezone).day;
    const month = parts(new Date(item.starts_at), timezone);
    if (month.year !== anchorParts.year || month.month !== anchorParts.month)
      continue;
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const instructors = [
    ...new Map(
      items.flatMap((item) => item.instructors ?? []).map((i) => [i.id, i]),
    ).values(),
  ];
  const programs = [...new Set(items.map((item) => item.program_title))];
  const venues = [
    ...new Map(
      items
        .filter((item) => item.venue_id && item.venue_name)
        .map((item) => [item.venue_id, item.venue_name]),
    ).entries(),
  ];
  const firstOffset = days[0]
    ? Math.max(0, englishWeek.indexOf(days[0].weekday))
    : 0;
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">برنامه‌ریزی</div>
          <h1 className="page-title">تقویم جلسات</h1>
          <p className="page-description">
            همه زمان‌ها به وقت {timezone} نمایش داده می‌شوند.
          </p>
        </div>
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <section className="card card-pad section">
        <div className="form-grid">
          <label className="field">
            <span className="label">مدرس</span>
            <select
              className="select"
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
            >
              <option value="">همه</option>
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">برنامه</span>
            <select
              className="select"
              value={program}
              onChange={(e) => setProgram(e.target.value)}
            >
              <option value="">همه</option>
              {programs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">مکان</span>
            <select
              className="select"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
            >
              <option value="">همه</option>
              {venues.map(([id, name]) => (
                <option key={id} value={id ?? ""}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">روش برگزاری</span>
            <select
              className="select"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="">همه</option>
              <option value="IN_PERSON">حضوری</option>
              <option value="ONLINE">آنلاین</option>
              <option value="HYBRID">ترکیبی</option>
            </select>
          </label>
        </div>
      </section>
      <section className="card card-pad">
        <div className="page-heading">
          <div>
            <h2 className="card-title">
              {anchorParts.monthName} {anchorParts.year}
            </h2>
            <p className="muted">
              {loading
                ? "در حال بارگذاری…"
                : `${filtered.length} جلسه قابل مشاهده`}
            </p>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setAnchor(new Date(anchor.getTime() - 31 * 86_400_000))
              }
            >
              ماه قبل
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAnchor(new Date())}
            >
              امروز
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setAnchor(new Date(anchor.getTime() + 31 * 86_400_000))
              }
            >
              ماه بعد
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setView(view === "month" ? "agenda" : "month")}
            >
              {view === "month" ? "نمای فهرست" : "نمای ماه"}
            </button>
          </div>
        </div>
        {view === "month" ? (
          <div className="calendar-grid">
            {weekdays.map((day) => (
              <div className="calendar-head" key={day}>
                {day}
              </div>
            ))}
            {weekdays.slice(0, firstOffset).map((day) => (
              <div
                key={`empty-${day}`}
                className="calendar-day calendar-blank"
              />
            ))}
            {days.map((day) => (
              <div className="calendar-day" key={day.day}>
                <strong>{Number(day.day).toLocaleString("fa-IR")}</strong>
                {(byDay.get(day.day) ?? []).map((item) => (
                  <div className="calendar-event" key={item.id}>
                    {item.title}
                    <small>{formatTenantDate(item.starts_at, timezone)}</small>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="calendar-agenda">
            {filtered
              .filter((item) => {
                const p = parts(new Date(item.starts_at), timezone);
                return (
                  p.year === anchorParts.year && p.month === anchorParts.month
                );
              })
              .map((item) => (
                <article key={item.id} className="check-row">
                  <div>
                    <strong>{item.title}</strong>
                    <p className="muted">{item.program_title}</p>
                  </div>
                  <span>{formatTenantDate(item.starts_at, timezone)}</span>
                </article>
              ))}
            {filtered.length === 0 && (
              <p className="empty">جلسه‌ای در این بازه نیست.</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
