import Link from "next/link";
import {
  listAttendanceSessions,
  listParticipantAttendanceReports,
} from "@/modules/attendance/repository";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function AttendancePage() {
  const { tenant, actor } = await requireTenantPage("attendance.view");
  const scope = { tenant, actor, requestId: "attendance-page" };
  const sessions = await listAttendanceSessions(scope);
  const reports = actor.permissions.has("session.manage")
    ? await listParticipantAttendanceReports(scope)
    : null;
  return (
    <main className="page-content" dir="rtl">
      <div className="page-heading">
        <div>
          <h1>حضور و غیاب</h1>
          <p>ثبت حضور جلسات و گزارش شرکت‌کنندگان</p>
        </div>
      </div>
      <section className="panel">
        <h2>جلسات</h2>
        {sessions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>جلسه</th>
                  <th>اجرا</th>
                  <th>تاریخ</th>
                  <th>مدرس</th>
                  <th>حاضر</th>
                  <th>درصد حضور</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.title}</td>
                    <td>{session.run_title}</td>
                    <td>
                      {new Date(session.starts_at).toLocaleString("fa-IR")}
                    </td>
                    <td>{session.instructor_names || "—"}</td>
                    <td>
                      {session.present + session.late} از {session.total}
                    </td>
                    <td>{session.attendancePercentage}٪</td>
                    <td>
                      <Link href={`/attendance/${session.id}`}>
                        ثبت و مشاهده
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>جلسه‌ای یافت نشد.</p>
        )}
      </section>
      {reports ? (
        <section className="panel">
          <h2>گزارش شرکت‌کنندگان</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>شرکت‌کننده</th>
                  <th>جلسات</th>
                  <th>حاضر</th>
                  <th>غایب</th>
                  <th>درصد</th>
                </tr>
              </thead>
              <tbody>
                {reports.entries.map((entry) => (
                  <tr key={entry.participant_id}>
                    <td>{entry.participant_name}</td>
                    <td>{entry.total}</td>
                    <td>{entry.attended}</td>
                    <td>{entry.absent}</td>
                    <td>{entry.percentage}٪</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
