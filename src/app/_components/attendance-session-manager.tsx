"use client";

import { useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import type { getSessionAttendance } from "@/modules/attendance/repository";

type Data = Awaited<ReturnType<typeof getSessionAttendance>>;
type Status = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export function AttendanceSessionManager({
  initial,
  canManage,
  canExport,
  canQr,
}: {
  initial: Data;
  canManage: boolean;
  canExport: boolean;
  canQr: boolean;
}) {
  const [data, setData] = useState(initial);
  const [marks, setMarks] = useState<Record<string, Status>>(
    Object.fromEntries(
      initial.records.map((row) => [
        row.participant_id,
        (row.status ?? "ABSENT") as Status,
      ]),
    ),
  );
  const [qr, setQr] = useState<{ token: string; expiresAt: string } | null>(
    null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(
      initial.records.map((row) => [row.participant_id, row.notes ?? ""]),
    ),
  );
  const [message, setMessage] = useState("");
  const id = data.session.id;
  async function refresh(page = data.page) {
    const response = await fetch(
      `/api/tenant/attendance/sessions/${id}?page=${page}`,
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message ?? "دریافت اطلاعات ناموفق بود.");
    setData(body.data);
    setMarks(
      Object.fromEntries(
        body.data.records.map((row: Data["records"][number]) => [
          row.participant_id,
          row.status ?? "ABSENT",
        ]),
      ),
    );
    setNotes(
      Object.fromEntries(
        body.data.records.map((row: Data["records"][number]) => [
          row.participant_id,
          row.notes ?? "",
        ]),
      ),
    );
    setSelected([]);
    setDirty([]);
  }
  async function mark() {
    setMessage("");
    const response = await fetch(`/api/tenant/attendance/sessions/${id}/mark`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        records: data.records
          .filter((row) => dirty.includes(row.participant_id))
          .map((row) => ({
            participantId: row.participant_id,
            status: marks[row.participant_id],
            notes: notes[row.participant_id] || null,
          })),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error?.message ?? "ثبت حضور ناموفق بود.");
      return;
    }
    setMessage("حضور ثبت شد.");
    await refresh();
  }
  async function issueQr() {
    setMessage("");
    const response = await fetch(`/api/tenant/attendance/sessions/${id}/qr`, {
      method: "POST",
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error?.message ?? "ساخت کد QR ناموفق بود.");
      return;
    }
    setQr(body.data);
  }
  return (
    <main className="page-content" dir="rtl">
      <div className="page-heading">
        <div>
          <Link href="/attendance">← حضور و غیاب</Link>
          <h1>{data.session.title}</h1>
          <p>
            {data.session.run_title} ·{" "}
            {new Date(data.session.starts_at).toLocaleString("fa-IR")}
          </p>
        </div>
      </div>
      <section className="panel">
        <h2>خلاصه حضور</h2>
        <p>
          حاضر: {data.summary.present} · تأخیر: {data.summary.late} · غایب:{" "}
          {data.summary.absent} · موجه: {data.summary.excused} · کل:{" "}
          {data.summary.total} · {data.summary.percentage}٪
        </p>
        {canExport ? (
          <a href={`/api/tenant/attendance/sessions/${id}/export`}>
            دریافت CSV
          </a>
        ) : null}
        {canQr ? (
          <div>
            <button type="button" onClick={issueQr}>
              ساخت QR کوتاه‌مدت
            </button>
            {qr ? (
              <div>
                <QRCodeSVG
                  value={`${window.location.origin}/check-in#token=${encodeURIComponent(qr.token)}`}
                  size={220}
                />
                <p>
                  اعتبار تا {new Date(qr.expiresAt).toLocaleTimeString("fa-IR")}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h2>فهرست شرکت‌کنندگان</h2>
        {canManage && data.records.length ? (
          <div>
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => {
                setDirty([...new Set([...dirty, ...selected])]);
                setMarks({
                  ...marks,
                  ...Object.fromEntries(selected.map((id) => [id, "PRESENT"])),
                });
              }}
            >
              حاضر برای انتخاب‌شده‌ها
            </button>
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => {
                setDirty([...new Set([...dirty, ...selected])]);
                setMarks({
                  ...marks,
                  ...Object.fromEntries(selected.map((id) => [id, "ABSENT"])),
                });
              }}
            >
              غایب برای انتخاب‌شده‌ها
            </button>
          </div>
        ) : null}
        {data.records.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {canManage ? <th>انتخاب</th> : null}
                  <th>شرکت‌کننده</th>
                  <th>وضعیت</th>
                  <th>زمان ورود</th>
                  <th>یادداشت</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((row) => (
                  <tr key={row.participant_id}>
                    {canManage ? (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`انتخاب ${row.participant_name}`}
                          checked={selected.includes(row.participant_id)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, row.participant_id]
                                : selected.filter(
                                    (id) => id !== row.participant_id,
                                  ),
                            )
                          }
                        />
                      </td>
                    ) : null}
                    <td>{row.participant_name}</td>
                    <td>
                      {canManage ? (
                        <select
                          aria-label={`وضعیت ${row.participant_name}`}
                          value={marks[row.participant_id] ?? "ABSENT"}
                          onChange={(event) => {
                            setDirty([
                              ...new Set([...dirty, row.participant_id]),
                            ]);
                            setMarks({
                              ...marks,
                              [row.participant_id]: event.target
                                .value as Status,
                            });
                          }}
                        >
                          <option value="PRESENT">حاضر</option>
                          <option value="ABSENT">غایب</option>
                          <option value="LATE">با تأخیر</option>
                          <option value="EXCUSED">موجه</option>
                        </select>
                      ) : (
                        (row.status ?? "ثبت نشده")
                      )}
                    </td>
                    <td>
                      {row.check_in_at
                        ? new Date(row.check_in_at).toLocaleString("fa-IR")
                        : "—"}
                    </td>
                    <td>
                      {canManage ? (
                        <input
                          aria-label={`یادداشت ${row.participant_name}`}
                          value={notes[row.participant_id] ?? ""}
                          maxLength={500}
                          onChange={(event) => {
                            setDirty([
                              ...new Set([...dirty, row.participant_id]),
                            ]);
                            setNotes({
                              ...notes,
                              [row.participant_id]: event.target.value,
                            });
                          }}
                        />
                      ) : (
                        row.notes || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>شرکت‌کننده‌ای یافت نشد.</p>
        )}
        {canManage && data.records.length ? (
          <button type="button" onClick={mark} disabled={!dirty.length}>
            ثبت حضور این صفحه
          </button>
        ) : null}
        {data.page > 1 ? (
          <button type="button" onClick={() => void refresh(data.page - 1)}>
            صفحه قبل
          </button>
        ) : null}
        {data.hasMore ? (
          <button type="button" onClick={() => void refresh(data.page + 1)}>
            صفحه بعد
          </button>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}
