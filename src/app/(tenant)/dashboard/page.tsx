import Link from "next/link";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";
import { formatTenantDate } from "@/modules/program-core/dates";

export default async function TenantDashboardPage() {
  const { tenant, actor } = await requireTenantPage("dashboard.read");
  const pool = getTenantPool(tenant);
  const canReadPrograms = actor.permissions.has("program.read"),
    canReadSessions = actor.permissions.has("session.read");
  const broad =
    actor.permissions.has("instructor.read") ||
    actor.permissions.has("session.manage");
  const metrics = canReadPrograms
    ? await pool.query<{
        active_programs: number;
        active_runs: number;
        planned_capacity: number;
      }>(
        `SELECT
      (SELECT count(*)::int FROM programs p WHERE p.tenant_id=$1 AND p.status='ACTIVE' AND ($3::boolean OR EXISTS (
        SELECT 1 FROM program_runs r JOIN run_instructors ri ON ri.tenant_id=r.tenant_id AND ri.run_id=r.id
        WHERE r.tenant_id=p.tenant_id AND r.program_id=p.id AND ri.instructor_id=$2))) AS active_programs,
      (SELECT count(*)::int FROM program_runs r WHERE r.tenant_id=$1 AND r.state='PUBLISHED' AND r.starts_at<=now() AND r.ends_at>now()
        AND ($3::boolean OR EXISTS (SELECT 1 FROM run_instructors ri WHERE ri.tenant_id=r.tenant_id AND ri.run_id=r.id AND ri.instructor_id=$2))) AS active_runs,
      (SELECT COALESCE(sum(r.capacity),0)::int FROM program_runs r WHERE r.tenant_id=$1 AND r.state='PUBLISHED' AND r.ends_at>now()
        AND ($3::boolean OR EXISTS (SELECT 1 FROM run_instructors ri WHERE ri.tenant_id=r.tenant_id AND ri.run_id=r.id AND ri.instructor_id=$2))) AS planned_capacity`,
        [tenant.tenantId, actor.id, broad],
      )
    : null;
  const sessions = canReadSessions
    ? await pool.query<{ today: number; this_week: number }>(
        `WITH permitted AS (
      SELECT s.starts_at FROM program_sessions s WHERE s.tenant_id=$1 AND s.status='SCHEDULED'
        AND ($3::boolean OR EXISTS (SELECT 1 FROM session_instructors si WHERE si.tenant_id=s.tenant_id AND si.session_id=s.id AND si.instructor_id=$2))
    ), local_clock AS (SELECT now() AT TIME ZONE $4 AS local_now)
    SELECT
      (SELECT count(*)::int FROM permitted,local_clock WHERE (starts_at AT TIME ZONE $4)::date=local_now::date) AS today,
      (SELECT count(*)::int FROM permitted,local_clock WHERE (starts_at AT TIME ZONE $4)::date >=
        local_now::date-((extract(dow FROM local_now)::int+1)%7)
        AND (starts_at AT TIME ZONE $4)::date < local_now::date-((extract(dow FROM local_now)::int+1)%7)+7) AS this_week`,
        [tenant.tenantId, actor.id, broad, tenant.timezone],
      )
    : null;
  const instructors = actor.permissions.has("instructor.read")
    ? await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_instructor_profiles profile JOIN tenant_users usr ON usr."tenantId"=profile.tenant_id AND usr.id=profile.user_id
     WHERE profile.tenant_id=$1 AND usr.status='ACTIVE'`,
        [tenant.tenantId],
      )
    : null;
  const upcoming = canReadSessions
    ? await pool.query<{
        id: string;
        title: string;
        run_title: string;
        starts_at: Date;
      }>(
        `SELECT s.id,s.title,r.title AS run_title,s.starts_at FROM program_sessions s JOIN program_runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
     WHERE s.tenant_id=$1 AND s.status='SCHEDULED' AND s.starts_at>=now()
       AND ($3::boolean OR EXISTS (SELECT 1 FROM session_instructors si WHERE si.tenant_id=s.tenant_id AND si.session_id=s.id AND si.instructor_id=$2))
     ORDER BY s.starts_at LIMIT 6`,
        [tenant.tenantId, actor.id, broad],
      )
    : null;
  const count = metrics?.rows[0],
    schedule = sessions?.rows[0];
  const cards = [
    { label: "برنامه‌های فعال", value: count?.active_programs ?? 0 },
    { label: "اجراهای در حال برگزاری", value: count?.active_runs ?? 0 },
    { label: "جلسات امروز", value: schedule?.today ?? 0 },
    { label: "جلسات این هفته", value: schedule?.this_week ?? 0 },
    { label: "مدرسان فعال", value: instructors?.rows[0]?.count ?? 0 },
    { label: "ظرفیت برنامه‌ریزی‌شده", value: count?.planned_capacity ?? 0 },
  ];
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">فضای سازمان</div>
          <h1 className="page-title">سلام {actor.name}</h1>
          <p className="page-description">نمایی از برنامه‌ها و جلسات مجاز شما</p>
        </div>
      </div>
      <div className="grid grid-4">
        {cards.map((card) => (
          <section className="card stat-card" key={card.label}>
            <span className="stat-label">{card.label}</span>
            <strong className="stat-value">
              {card.value.toLocaleString("fa-IR")}
            </strong>
          </section>
        ))}
      </div>
      <section className="card card-pad section">
        <div className="page-heading">
          <h2 className="card-title">جلسات پیش رو</h2>
          {canReadSessions && (
            <Link className="link" href="/calendar">
              مشاهده تقویم
            </Link>
          )}
        </div>
        {upcoming?.rows.length ? (
          upcoming.rows.map((item) => (
            <div className="check-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p className="muted">{item.run_title}</p>
              </div>
              <span>{formatTenantDate(item.starts_at, tenant.timezone)}</span>
            </div>
          ))
        ) : (
          <p className="empty">جلسه‌ای در پیش نیست.</p>
        )}
      </section>
    </main>
  );
}
