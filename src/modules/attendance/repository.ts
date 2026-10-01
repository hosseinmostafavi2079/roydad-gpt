import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { getServerConfig } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { attendancePercentage, type AttendanceMarkInput } from "./schema";
import { checkInWindow, signQrChallenge, verifyQrChallenge } from "./qr";

type Scope = Readonly<{
  tenant: TenantContext;
  actor: TenantActor;
  requestId: string;
}>;
type Db = Pool | PoolClient;
type SessionRow = {
  id: string;
  run_id: string;
  title: string;
  run_title: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  instructor_names: string;
};

function requireAttendance(scope: Scope, permission: string): void {
  if (scope.actor.tenantId !== scope.tenant.tenantId)
    throw new DomainError("FORBIDDEN", "جلسه متعلق به این مجموعه نیست.");
  if (!scope.tenant.features.attendance)
    throw new DomainError("FEATURE_DISABLED", "حضور و غیاب فعال نیست.");
  authorize(scope.actor.permissions, permission);
}

async function instructorOnly(db: Db, scope: Scope): Promise<boolean> {
  if (scope.actor.permissions.has("session.manage")) return false;
  const result = await db.query<{ instructor: boolean; officer: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM tenant_instructor_profiles WHERE tenant_id=$1 AND user_id=$2) AS instructor,
       EXISTS (SELECT 1 FROM tenant_user_roles ur JOIN tenant_roles role
         ON role.tenant_id=ur.tenant_id AND role.id=ur.role_id
         WHERE ur.tenant_id=$1 AND ur.user_id=$2
           AND role.code IN ('organization_owner','organization_admin','attendance_officer')) AS officer`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  return Boolean(result.rows[0]?.instructor && !result.rows[0]?.officer);
}

async function permittedSession(
  db: Db,
  scope: Scope,
  sessionId: string,
  lock = false,
): Promise<SessionRow> {
  const result = await db.query<SessionRow>(
    `SELECT s.id,s.run_id,s.title,s.starts_at,s.ends_at,s.status,r.title AS run_title,
       COALESCE((SELECT string_agg(COALESCE(profile.display_name, usr.name), '، ' ORDER BY usr.name)
         FROM session_instructors si JOIN tenant_users usr ON usr."tenantId"=si.tenant_id AND usr.id=si.instructor_id
         LEFT JOIN tenant_instructor_profiles profile ON profile.tenant_id=si.tenant_id AND profile.user_id=si.instructor_id
         WHERE si.tenant_id=s.tenant_id AND si.session_id=s.id),'') AS instructor_names
     FROM program_sessions s JOIN program_runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
     WHERE s.tenant_id=$1 AND s.id=$2 ${lock ? "FOR UPDATE OF s" : ""}`,
    [scope.tenant.tenantId, sessionId],
  );
  const session = result.rows[0];
  if (!session) throw new DomainError("NOT_FOUND", "جلسه یافت نشد.");
  if (await instructorOnly(db, scope)) {
    const assignment = await db.query(
      `SELECT 1 FROM session_instructors si WHERE si.tenant_id=$1 AND si.session_id=$2 AND si.instructor_id=$3`,
      [scope.tenant.tenantId, sessionId, scope.actor.id],
    );
    if (!assignment.rowCount)
      throw new DomainError("NOT_FOUND", "جلسه یافت نشد.");
  }
  return session;
}

async function audit(
  client: PoolClient,
  scope: Scope,
  action: string,
  targetType: string,
  targetId: string,
  afterState: Record<string, unknown> = {},
): Promise<void> {
  await client.query(
    `INSERT INTO tenant_audit_logs
       (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      scope.tenant.tenantId,
      scope.actor.id,
      action,
      targetType,
      targetId,
      scope.requestId,
      JSON.stringify(afterState),
    ],
  );
}

export async function listAttendanceSessions(scope: Scope) {
  requireAttendance(scope, "attendance.view");
  const restricted = await instructorOnly(getTenantPool(scope.tenant), scope);
  const result = await getTenantPool(scope.tenant).query<
    SessionRow & {
      total: number;
      present: number;
      late: number;
      absent: number;
    }
  >(
    `SELECT s.id,s.run_id,s.title,s.starts_at,s.ends_at,s.status,r.title AS run_title,
       COALESCE((SELECT string_agg(usr.name, '، ' ORDER BY usr.name)
         FROM session_instructors si JOIN tenant_users usr ON usr."tenantId"=si.tenant_id AND usr.id=si.instructor_id
         WHERE si.tenant_id=s.tenant_id AND si.session_id=s.id),'') AS instructor_names,
       (SELECT count(*)::int FROM enrollments e WHERE e.tenant_id=s.tenant_id AND e.run_id=s.run_id
         AND e.status IN ('CONFIRMED','COMPLETED')) AS total,
       (SELECT count(*)::int FROM attendance_records a WHERE a.tenant_id=s.tenant_id AND a.session_id=s.id AND a.status='PRESENT') AS present,
       (SELECT count(*)::int FROM attendance_records a WHERE a.tenant_id=s.tenant_id AND a.session_id=s.id AND a.status='LATE') AS late,
       (SELECT count(*)::int FROM attendance_records a WHERE a.tenant_id=s.tenant_id AND a.session_id=s.id AND a.status='ABSENT') AS absent
     FROM program_sessions s JOIN program_runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id
     WHERE s.tenant_id=$1 AND ($2::boolean=false OR EXISTS
       (SELECT 1 FROM session_instructors si WHERE si.tenant_id=s.tenant_id AND si.session_id=s.id AND si.instructor_id=$3))
     ORDER BY s.starts_at DESC,s.id DESC LIMIT 200`,
    [scope.tenant.tenantId, restricted, scope.actor.id],
  );
  return result.rows.map((row) => ({
    ...row,
    attendancePercentage: attendancePercentage(
      row.present + row.late,
      row.total,
    ),
  }));
}

export async function getSessionAttendance(
  scope: Scope,
  sessionId: string,
  page = 1,
) {
  requireAttendance(scope, "attendance.view");
  const pool = getTenantPool(scope.tenant);
  const session = await permittedSession(pool, scope, sessionId);
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), 1000);
  const [roster, counts] = await Promise.all([
    pool.query<{
      participant_id: string;
      participant_name: string;
      status: string | null;
      check_in_at: Date | null;
      notes: string | null;
    }>(
      `SELECT e.participant_id,COALESCE(profile.display_name,usr.name) AS participant_name,
         attendance.status,attendance.check_in_at,attendance.notes
       FROM enrollments e
       JOIN tenant_users usr ON usr."tenantId"=e.tenant_id AND usr.id=e.participant_id
       LEFT JOIN tenant_participant_profiles profile ON profile.tenant_id=e.tenant_id AND profile.user_id=e.participant_id
       LEFT JOIN attendance_records attendance ON attendance.tenant_id=e.tenant_id
         AND attendance.session_id=$2 AND attendance.participant_id=e.participant_id
       WHERE e.tenant_id=$1 AND e.run_id=$3 AND e.status IN ('CONFIRMED','COMPLETED')
       ORDER BY participant_name,e.participant_id LIMIT 101 OFFSET $4`,
      [scope.tenant.tenantId, sessionId, session.run_id, (safePage - 1) * 100],
    ),
    pool.query<{
      total: number;
      present: number;
      absent: number;
      late: number;
      excused: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM enrollments e WHERE e.tenant_id=$1 AND e.run_id=$3 AND e.status IN ('CONFIRMED','COMPLETED')) AS total,
         count(*) FILTER (WHERE status='PRESENT')::int AS present,
         count(*) FILTER (WHERE status='ABSENT')::int AS absent,
         count(*) FILTER (WHERE status='LATE')::int AS late,
         count(*) FILTER (WHERE status='EXCUSED')::int AS excused
       FROM attendance_records WHERE tenant_id=$1 AND session_id=$2`,
      [scope.tenant.tenantId, sessionId, session.run_id],
    ),
  ]);
  const summary = counts.rows[0] ?? {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
  };
  return {
    session,
    summary: {
      ...summary,
      percentage: attendancePercentage(
        summary.present + summary.late,
        summary.total,
      ),
    },
    records: roster.rows.slice(0, 100),
    page: safePage,
    hasMore: roster.rows.length > 100,
  };
}

export async function markAttendanceBatch(
  scope: Scope,
  sessionId: string,
  input: AttendanceMarkInput,
) {
  requireAttendance(scope, "attendance.manage");
  const identifiers = input.records.map((entry) => entry.participantId);
  if (new Set(identifiers).size !== identifiers.length)
    throw new DomainError("VALIDATION_FAILED", "شرکت‌کننده تکراری است.");
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const session = await permittedSession(client, scope, sessionId, true);
    if (session.status !== "SCHEDULED")
      throw new DomainError(
        "SESSION_NOT_OPEN",
        "جلسه برای ثبت حضور فعال نیست.",
      );
    const eligible = await client.query<{ participant_id: string }>(
      `SELECT participant_id FROM enrollments WHERE tenant_id=$1 AND run_id=$2
       AND status IN ('CONFIRMED','COMPLETED') AND participant_id=ANY($3::varchar[])`,
      [scope.tenant.tenantId, session.run_id, identifiers],
    );
    if (eligible.rows.length !== identifiers.length)
      throw new DomainError(
        "FORBIDDEN",
        "برخی شرکت‌کنندگان در این اجرا ثبت‌نام معتبر ندارند.",
      );
    for (const record of input.records) {
      const checkIn = ["PRESENT", "LATE"].includes(record.status)
        ? new Date()
        : null;
      await client.query(
        `INSERT INTO attendance_records
           (tenant_id,session_id,participant_id,status,check_in_at,marked_by_user_id,notes,source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'STAFF')
         ON CONFLICT (tenant_id,session_id,participant_id) DO UPDATE SET
           status=excluded.status,check_in_at=excluded.check_in_at,
           marked_by_user_id=excluded.marked_by_user_id,notes=excluded.notes,
           source='STAFF',updated_at=now()`,
        [
          scope.tenant.tenantId,
          sessionId,
          record.participantId,
          record.status,
          checkIn,
          scope.actor.id,
          record.notes,
        ],
      );
    }
    await audit(client, scope, "attendance.marked", "SESSION", sessionId, {
      count: input.records.length,
    });
    await client.query("COMMIT");
    return { saved: input.records.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function qrSecret(): string {
  return createHmac("sha256", getServerConfig().BETTER_AUTH_SECRET)
    .update("attendance-qr-v1")
    .digest("hex");
}

export async function issueAttendanceQr(scope: Scope, sessionId: string) {
  requireAttendance(scope, "attendance.manage");
  if (!scope.tenant.features.qr_attendance)
    throw new DomainError("FEATURE_DISABLED", "ثبت حضور با QR فعال نیست.");
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const session = await permittedSession(client, scope, sessionId, true);
    const now = new Date();
    if (
      session.status !== "SCHEDULED" ||
      !checkInWindow(session.starts_at, session.ends_at, now)
    )
      throw new DomainError(
        "SESSION_NOT_OPEN",
        "پنجره ثبت حضور این جلسه باز نیست.",
      );
    const expiresAt = Math.floor(now.getTime() / 1000) + 90;
    const challengeId = randomUUID();
    await client.query(
      `INSERT INTO attendance_qr_challenges
         (tenant_id,id,session_id,issued_by_user_id,expires_at)
       VALUES ($1,$2,$3,$4,to_timestamp($5))`,
      [
        scope.tenant.tenantId,
        challengeId,
        sessionId,
        scope.actor.id,
        expiresAt,
      ],
    );
    await audit(client, scope, "attendance.qr.issued", "SESSION", sessionId, {
      challengeId,
      expiresAt,
    });
    await client.query("COMMIT");
    return {
      token: signQrChallenge(
        {
          version: 1,
          tenantId: scope.tenant.tenantId,
          sessionId,
          challengeId,
          expiresAt,
        },
        qrSecret(),
      ),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkInWithQr(scope: Scope, token: string) {
  requireAttendance(scope, "attendance.checkin");
  if (!scope.tenant.features.qr_attendance)
    throw new DomainError("FEATURE_DISABLED", "ثبت حضور با QR فعال نیست.");
  const payload = verifyQrChallenge(token, qrSecret(), scope.tenant.tenantId);
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const challenge = await client.query<{
      expires_at: Date;
      revoked_at: Date | null;
      starts_at: Date;
      ends_at: Date;
      status: string;
      run_id: string;
    }>(
      `SELECT qr.expires_at,qr.revoked_at,s.starts_at,s.ends_at,s.status,s.run_id
       FROM attendance_qr_challenges qr JOIN program_sessions s
         ON s.tenant_id=qr.tenant_id AND s.id=qr.session_id
       WHERE qr.tenant_id=$1 AND qr.id=$2 AND qr.session_id=$3 FOR UPDATE OF qr`,
      [scope.tenant.tenantId, payload.challengeId, payload.sessionId],
    );
    const row = challenge.rows[0];
    if (!row || row.revoked_at)
      throw new DomainError("INVALID_QR", "کد حضور معتبر نیست.");
    if (row.expires_at.getTime() <= Date.now())
      throw new DomainError("QR_EXPIRED", "اعتبار کد حضور به پایان رسیده است.");
    if (
      row.status !== "SCHEDULED" ||
      !checkInWindow(row.starts_at, row.ends_at)
    )
      throw new DomainError(
        "SESSION_NOT_OPEN",
        "پنجره ثبت حضور این جلسه باز نیست.",
      );
    const participant = await client.query(
      `SELECT 1 FROM tenant_participant_profiles profile JOIN enrollments e
         ON e.tenant_id=profile.tenant_id AND e.participant_id=profile.user_id
       WHERE profile.tenant_id=$1 AND profile.user_id=$2 AND e.run_id=$3
         AND e.status IN ('CONFIRMED','COMPLETED')`,
      [scope.tenant.tenantId, scope.actor.id, row.run_id],
    );
    if (!participant.rowCount)
      throw new DomainError(
        "FORBIDDEN",
        "ثبت‌نام معتبر برای این جلسه یافت نشد.",
      );
    const usage = await client.query(
      `INSERT INTO attendance_qr_uses (tenant_id,challenge_id,participant_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING participant_id`,
      [scope.tenant.tenantId, payload.challengeId, scope.actor.id],
    );
    if (!usage.rowCount)
      throw new DomainError(
        "QR_REPLAYED",
        "حضور این شرکت‌کننده پیش‌تر ثبت شده است.",
      );
    const recorded = await client.query(
      `INSERT INTO attendance_records
         (tenant_id,session_id,participant_id,status,check_in_at,marked_by_user_id,source)
       VALUES ($1,$2,$3,'PRESENT',now(),$3,'QR')
       ON CONFLICT (tenant_id,session_id,participant_id) DO NOTHING RETURNING id`,
      [scope.tenant.tenantId, payload.sessionId, scope.actor.id],
    );
    if (!recorded.rowCount)
      throw new DomainError(
        "QR_REPLAYED",
        "حضور این شرکت‌کننده پیش‌تر ثبت شده است.",
      );
    await audit(
      client,
      scope,
      "attendance.qr.checked_in",
      "SESSION",
      payload.sessionId,
    );
    await client.query("COMMIT");
    return { sessionId: payload.sessionId, status: "PRESENT" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listOwnAttendance(scope: Scope) {
  requireAttendance(scope, "attendance.self.read");
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    title: string;
    run_title: string;
    starts_at: Date;
    status: string | null;
    check_in_at: Date | null;
  }>(
    `SELECT s.id,s.title,r.title AS run_title,s.starts_at,a.status,a.check_in_at
     FROM tenant_participant_profiles profile
     JOIN enrollments e ON e.tenant_id=profile.tenant_id AND e.participant_id=profile.user_id
     JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     JOIN program_sessions s ON s.tenant_id=r.tenant_id AND s.run_id=r.id
     LEFT JOIN attendance_records a ON a.tenant_id=s.tenant_id AND a.session_id=s.id AND a.participant_id=$2
     WHERE profile.tenant_id=$1 AND profile.user_id=$2 AND e.status IN ('CONFIRMED','COMPLETED')
       AND s.ends_at<=now() AND s.status<>'CANCELLED'
     ORDER BY s.starts_at DESC LIMIT 200`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  const totals = await getTenantPool(scope.tenant).query<{
    total: number;
    attended: number;
    absent: number;
  }>(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE a.status IN ('PRESENT','LATE'))::int AS attended,
       count(*) FILTER (WHERE a.status='ABSENT')::int AS absent
     FROM enrollments e JOIN program_sessions s ON s.tenant_id=e.tenant_id AND s.run_id=e.run_id
     LEFT JOIN attendance_records a ON a.tenant_id=s.tenant_id AND a.session_id=s.id AND a.participant_id=e.participant_id
     WHERE e.tenant_id=$1 AND e.participant_id=$2 AND e.status IN ('CONFIRMED','COMPLETED')
       AND s.ends_at<=now() AND s.status<>'CANCELLED'`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  const summary = totals.rows[0] ?? { total: 0, attended: 0, absent: 0 };
  return {
    records: result.rows,
    summary: {
      ...summary,
      percentage: attendancePercentage(summary.attended, summary.total),
    },
  };
}

export async function getNextOwnSession(scope: Scope) {
  requireAttendance(scope, "attendance.self.read");
  const result = await getTenantPool(scope.tenant).query<{
    id: string;
    title: string;
    run_title: string;
    starts_at: Date;
  }>(
    `SELECT s.id,s.title,r.title AS run_title,s.starts_at
     FROM enrollments e JOIN program_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id
     JOIN program_sessions s ON s.tenant_id=r.tenant_id AND s.run_id=r.id
     WHERE e.tenant_id=$1 AND e.participant_id=$2 AND e.status IN ('CONFIRMED','COMPLETED')
       AND s.starts_at > now() AND s.status='SCHEDULED'
     ORDER BY s.starts_at,s.id LIMIT 1`,
    [scope.tenant.tenantId, scope.actor.id],
  );
  return result.rows[0] ?? null;
}

export async function listParticipantAttendanceReports(scope: Scope, page = 1) {
  requireAttendance(scope, "attendance.view");
  if (await instructorOnly(getTenantPool(scope.tenant), scope))
    throw new DomainError("FORBIDDEN", "گزارش همه شرکت‌کنندگان مجاز نیست.");
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), 1000);
  const result = await getTenantPool(scope.tenant).query<{
    participant_id: string;
    participant_name: string;
    total: number;
    attended: number;
    absent: number;
  }>(
    `SELECT profile.user_id AS participant_id,profile.display_name AS participant_name,
       count(s.id)::int AS total,
       count(s.id) FILTER (WHERE a.status IN ('PRESENT','LATE'))::int AS attended,
       count(s.id) FILTER (WHERE a.status='ABSENT')::int AS absent
     FROM tenant_participant_profiles profile
     JOIN enrollments e ON e.tenant_id=profile.tenant_id AND e.participant_id=profile.user_id
       AND e.status IN ('CONFIRMED','COMPLETED')
     JOIN program_sessions s ON s.tenant_id=e.tenant_id AND s.run_id=e.run_id
       AND s.ends_at<=now() AND s.status<>'CANCELLED'
     LEFT JOIN attendance_records a ON a.tenant_id=s.tenant_id AND a.session_id=s.id
       AND a.participant_id=profile.user_id
     WHERE profile.tenant_id=$1 GROUP BY profile.user_id,profile.display_name
     ORDER BY profile.display_name,profile.user_id LIMIT 101 OFFSET $2`,
    [scope.tenant.tenantId, (safePage - 1) * 100],
  );
  return {
    entries: result.rows.slice(0, 100).map((row) => ({
      ...row,
      percentage: attendancePercentage(row.attended, row.total),
    })),
    page: safePage,
    hasMore: result.rows.length > 100,
  };
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function exportSessionAttendance(scope: Scope, sessionId: string) {
  requireAttendance(scope, "attendance.export");
  const pool = getTenantPool(scope.tenant);
  const session = await permittedSession(pool, scope, sessionId);
  const result = await pool.query<{
    participant_name: string;
    status: string | null;
    check_in_at: Date | null;
    notes: string | null;
  }>(
    `SELECT COALESCE(profile.display_name,usr.name) AS participant_name,
       a.status,a.check_in_at,a.notes
     FROM enrollments e JOIN tenant_users usr ON usr."tenantId"=e.tenant_id AND usr.id=e.participant_id
     LEFT JOIN tenant_participant_profiles profile ON profile.tenant_id=e.tenant_id AND profile.user_id=e.participant_id
     LEFT JOIN attendance_records a ON a.tenant_id=e.tenant_id AND a.session_id=$2 AND a.participant_id=e.participant_id
     WHERE e.tenant_id=$1 AND e.run_id=$3 AND e.status IN ('CONFIRMED','COMPLETED')
     ORDER BY participant_name,e.participant_id LIMIT 5001`,
    [scope.tenant.tenantId, sessionId, session.run_id],
  );
  if (result.rows.length > 5000)
    throw new DomainError("LIMIT_REACHED", "خروجی بیش از ۵۰۰۰ ردیف است.");
  const lines = ["شرکت‌کننده,وضعیت,زمان ورود,یادداشت"];
  for (const row of result.rows) {
    lines.push(
      [
        row.participant_name,
        row.status ?? "ثبت‌نشده",
        row.check_in_at?.toISOString() ?? "",
        row.notes ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await pool.query(
    `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
     VALUES ($1,$2,'attendance.exported','SESSION',$3,$4,$5::jsonb)`,
    [
      scope.tenant.tenantId,
      scope.actor.id,
      sessionId,
      scope.requestId,
      JSON.stringify({ count: result.rows.length }),
    ],
  );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
