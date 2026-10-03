import "server-only";

import type { PoolClient } from "pg";
import {
  getTenantPool,
  type TenantPoolContext,
} from "@/infrastructure/db/tenant/pool";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import type { ProgramInput, RunInput, SessionInput } from "./schema";
import { mayTransition, programTransitions, runTransitions } from "./domain";

type Scope = Readonly<{
  tenant: TenantPoolContext;
  actor: TenantActor;
  requestId: string;
}>;
type Row = Record<string, unknown>;

function assertScope(scope: Scope, permission: string): void {
  if (scope.tenant.tenantId !== scope.actor.tenantId) {
    throw new DomainError("FORBIDDEN", "The resource is outside this tenant.");
  }
  authorize(scope.actor.permissions, permission);
}

async function transaction<T>(
  scope: Scope,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new DomainError(
        "CONFLICT",
        "A resource with these details already exists.",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function audit(
  client: PoolClient,
  scope: Scope,
  action: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO tenant_audit_logs (tenant_id, actor_id, action, target_type, target_id, request_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      scope.tenant.tenantId,
      scope.actor.id,
      action,
      targetType,
      targetId,
      scope.requestId,
    ],
  );
}

function broadRead(actor: TenantActor): boolean {
  return (
    actor.permissions.has("instructor.read") ||
    actor.permissions.has("session.manage")
  );
}

export async function listPrograms(
  scope: Scope,
  search = "",
  type = "",
  status = "",
): Promise<Row[]> {
  assertScope(scope, "program.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT p.*, (SELECT count(*)::int FROM program_runs r WHERE r.tenant_id = p.tenant_id AND r.program_id = p.id) AS run_count,
       (SELECT '/api/media/' || m.id::text FROM tenant_media m WHERE m.tenant_id=p.tenant_id AND m.resource_id=p.id AND m.purpose='PROGRAM_COVER') AS cover_url,
       (SELECT '/api/media/' || m.id::text FROM tenant_media m WHERE m.tenant_id=p.tenant_id AND m.resource_id=p.id AND m.purpose='PROGRAM_VIDEO') AS video_url,
       (SELECT min(r.starts_at) FROM program_runs r WHERE r.tenant_id=p.tenant_id AND r.program_id=p.id) AS next_run_at,
       (SELECT instructor.display_name FROM program_runs r JOIN run_instructors ri ON ri.tenant_id=r.tenant_id AND ri.run_id=r.id AND ri.is_lead JOIN tenant_instructor_profiles instructor ON instructor.tenant_id=ri.tenant_id AND instructor.user_id=ri.instructor_id WHERE r.tenant_id=p.tenant_id AND r.program_id=p.id ORDER BY r.starts_at LIMIT 1) AS lead_instructor
     FROM programs p WHERE p.tenant_id = $1
       AND ($2 = '' OR p.title ILIKE '%' || $2 || '%')
       AND ($3 = '' OR p.type = $3) AND ($4 = '' OR p.status = $4)
       AND ($5::boolean OR EXISTS (
         SELECT 1 FROM program_runs r JOIN run_instructors ri ON ri.tenant_id = r.tenant_id AND ri.run_id = r.id
         WHERE r.tenant_id = p.tenant_id AND r.program_id = p.id AND ri.instructor_id = $6)
       OR EXISTS (SELECT 1 FROM program_runs r JOIN program_sessions s ON s.tenant_id=r.tenant_id AND s.run_id=r.id
         JOIN session_instructors si ON si.tenant_id=s.tenant_id AND si.session_id=s.id
         WHERE r.tenant_id=p.tenant_id AND r.program_id=p.id AND si.instructor_id=$6))
     ORDER BY p.created_at DESC LIMIT 200`,
    [
      scope.tenant.tenantId,
      search.slice(0, 100),
      type,
      status,
      broadRead(scope.actor),
      scope.actor.id,
    ],
  );
  return result.rows;
}

export async function getProgram(scope: Scope, id: string): Promise<Row> {
  assertScope(scope, "program.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT p.* FROM programs p WHERE p.tenant_id=$1 AND p.id=$2
    AND ($3::boolean OR EXISTS (SELECT 1 FROM program_runs r LEFT JOIN run_instructors ri ON ri.tenant_id=r.tenant_id AND ri.run_id=r.id
      WHERE r.tenant_id=p.tenant_id AND r.program_id=p.id AND ri.instructor_id=$4)
      OR EXISTS (SELECT 1 FROM program_runs r JOIN program_sessions s ON s.tenant_id=r.tenant_id AND s.run_id=r.id
        JOIN session_instructors si ON si.tenant_id=s.tenant_id AND si.session_id=s.id
        WHERE r.tenant_id=p.tenant_id AND r.program_id=p.id AND si.instructor_id=$4))`,
    [scope.tenant.tenantId, id, broadRead(scope.actor), scope.actor.id],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Program not found.");
  return result.rows[0];
}

export async function createProgram(
  scope: Scope,
  input: ProgramInput,
): Promise<Row> {
  assertScope(scope, "program.create");
  return transaction(scope, async (client) => {
    const maxPrograms = (
      scope.tenant as TenantPoolContext & { limits?: { max_programs: number } }
    ).limits?.max_programs;
    if (maxPrograms !== undefined) {
      await client.query(
        "SELECT tenant_id FROM tenant_metadata WHERE tenant_id=$1 FOR UPDATE",
        [scope.tenant.tenantId],
      );
      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM programs WHERE tenant_id=$1 AND status<>'ARCHIVED'",
        [scope.tenant.tenantId],
      );
      if ((count.rows[0]?.count ?? 0) >= maxPrograms)
        throw new DomainError(
          "LIMIT_REACHED",
          "سقف تعداد برنامه‌های این مجموعه تکمیل شده است.",
        );
    }
    const result = await client.query(
      `INSERT INTO programs (tenant_id, type, title, slug, short_description, description, category, level,
         objectives, prerequisites, intended_audience, default_duration_minutes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        scope.tenant.tenantId,
        input.type,
        input.title,
        input.slug,
        input.shortDescription,
        input.description,
        input.category,
        input.level,
        input.objectives,
        input.prerequisites,
        input.intendedAudience,
        input.defaultDurationMinutes,
        scope.actor.id,
      ],
    );
    const row = result.rows[0];
    await audit(client, scope, "program.created", "PROGRAM", row.id);
    return row;
  });
}

export async function updateProgram(
  scope: Scope,
  id: string,
  input: ProgramInput,
): Promise<Row> {
  assertScope(scope, "program.update");
  return transaction(scope, async (client) => {
    const result = await client.query(
      `UPDATE programs SET type=$3, title=$4, slug=$5, short_description=$6, description=$7,
         category=$8, level=$9, objectives=$10, prerequisites=$11, intended_audience=$12,
         default_duration_minutes=$13, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status <> 'ARCHIVED' RETURNING *`,
      [
        scope.tenant.tenantId,
        id,
        input.type,
        input.title,
        input.slug,
        input.shortDescription,
        input.description,
        input.category,
        input.level,
        input.objectives,
        input.prerequisites,
        input.intendedAudience,
        input.defaultDurationMinutes,
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new DomainError("NOT_FOUND", "Program not found or archived.");
    await audit(client, scope, "program.updated", "PROGRAM", id);
    return row;
  });
}

export async function transitionProgram(
  scope: Scope,
  id: string,
  target: "ACTIVE" | "ARCHIVED",
): Promise<Row> {
  assertScope(
    scope,
    target === "ACTIVE" ? "program.publish" : "program.delete",
  );
  return transaction(scope, async (client) => {
    const current = await client.query<{ status: string }>(
      "SELECT status FROM programs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, id],
    );
    if (!current.rows[0])
      throw new DomainError("NOT_FOUND", "Program not found.");
    if (!mayTransition(current.rows[0].status, target, programTransitions))
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Program state cannot change this way.",
      );
    const result = await client.query(
      `UPDATE programs SET status=$3, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [scope.tenant.tenantId, id, target],
    );
    const row = result.rows[0];
    if (!row)
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Program state cannot change this way.",
      );
    await audit(
      client,
      scope,
      target === "ARCHIVED" ? "program.archived" : "program.updated",
      "PROGRAM",
      id,
    );
    return row;
  });
}

export async function listVenues(scope: Scope): Promise<Row[]> {
  if (!scope.actor.permissions.has("settings.read"))
    assertScope(scope, "session.manage");
  else assertScope(scope, "settings.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT v.*, COALESCE(json_agg(json_build_object('id', r.id, 'name', r.name, 'capacity', r.capacity, 'description', r.description, 'active', r.active)) FILTER (WHERE r.id IS NOT NULL), '[]') AS rooms
     FROM venues v LEFT JOIN rooms r ON r.tenant_id=v.tenant_id AND r.venue_id=v.id
     WHERE v.tenant_id=$1 GROUP BY v.tenant_id,v.id ORDER BY v.name`,
    [scope.tenant.tenantId],
  );
  return result.rows;
}

export async function getVenue(scope: Scope, id: string): Promise<Row> {
  if (!scope.actor.permissions.has("settings.read"))
    assertScope(scope, "session.manage");
  else assertScope(scope, "settings.read");
  const result = await getTenantPool(scope.tenant).query(
    "SELECT * FROM venues WHERE tenant_id=$1 AND id=$2",
    [scope.tenant.tenantId, id],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Venue not found.");
  return result.rows[0];
}

export async function getRoom(scope: Scope, id: string): Promise<Row> {
  if (!scope.actor.permissions.has("settings.read"))
    assertScope(scope, "session.manage");
  else assertScope(scope, "settings.read");
  const result = await getTenantPool(scope.tenant).query(
    "SELECT * FROM rooms WHERE tenant_id=$1 AND id=$2",
    [scope.tenant.tenantId, id],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Room not found.");
  return result.rows[0];
}

export async function createVenue(
  scope: Scope,
  input: {
    name: string;
    address: string;
    city: string;
    description: string;
    active: boolean;
  },
): Promise<Row> {
  assertScope(scope, "settings.manage");
  return transaction(scope, async (client) => {
    const result = await client.query(
      `INSERT INTO venues (tenant_id,name,address,city,description,active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        scope.tenant.tenantId,
        input.name,
        input.address,
        input.city,
        input.description,
        input.active,
        scope.actor.id,
      ],
    );
    const row = result.rows[0];
    await audit(client, scope, "venue.created", "VENUE", row.id);
    return row;
  });
}

export async function createRoom(
  scope: Scope,
  input: {
    venueId: string;
    name: string;
    capacity: number;
    description: string;
    active: boolean;
  },
): Promise<Row> {
  assertScope(scope, "settings.manage");
  return transaction(scope, async (client) => {
    const venue = await client.query(
      "SELECT id FROM venues WHERE tenant_id=$1 AND id=$2 AND active",
      [scope.tenant.tenantId, input.venueId],
    );
    if (!venue.rowCount) throw new DomainError("NOT_FOUND", "Venue not found.");
    const result = await client.query(
      `INSERT INTO rooms (tenant_id,venue_id,name,capacity,description,active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        scope.tenant.tenantId,
        input.venueId,
        input.name,
        input.capacity,
        input.description,
        input.active,
      ],
    );
    const row = result.rows[0];
    await audit(client, scope, "room.created", "ROOM", row.id);
    return row;
  });
}

export async function updateVenue(
  scope: Scope,
  id: string,
  input: {
    name: string;
    address: string;
    city: string;
    description: string;
    active: boolean;
  },
): Promise<Row> {
  assertScope(scope, "settings.manage");
  return transaction(scope, async (client) => {
    const result = await client.query(
      `UPDATE venues SET name=$3,address=$4,city=$5,description=$6,active=$7,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [
        scope.tenant.tenantId,
        id,
        input.name,
        input.address,
        input.city,
        input.description,
        input.active,
      ],
    );
    if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Venue not found.");
    await audit(client, scope, "venue.updated", "VENUE", id);
    return result.rows[0];
  });
}

export async function updateRoom(
  scope: Scope,
  id: string,
  input: {
    venueId: string;
    name: string;
    capacity: number;
    description: string;
    active: boolean;
  },
): Promise<Row> {
  assertScope(scope, "settings.manage");
  return transaction(scope, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`eventos-schedule:${scope.tenant.tenantId}`],
    );
    const current = await client.query<{ venue_id: string }>(
      "SELECT venue_id FROM rooms WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, id],
    );
    if (!current.rows[0]) throw new DomainError("NOT_FOUND", "Room not found.");
    const venue = await client.query(
      "SELECT id FROM venues WHERE tenant_id=$1 AND id=$2 AND active",
      [scope.tenant.tenantId, input.venueId],
    );
    if (!venue.rowCount) throw new DomainError("NOT_FOUND", "Venue not found.");
    if (current.rows[0].venue_id !== input.venueId) {
      const booked = await client.query(
        "SELECT id FROM program_sessions WHERE tenant_id=$1 AND room_id=$2 AND status='SCHEDULED' LIMIT 1",
        [scope.tenant.tenantId, id],
      );
      if (booked.rowCount)
        throw new DomainError(
          "CONFLICT",
          "Move the scheduled sessions before changing this room's venue.",
        );
    }
    const tooSmall = await client.query(
      `SELECT session_row.id FROM program_sessions session_row JOIN program_runs run ON run.tenant_id=session_row.tenant_id AND run.id=session_row.run_id
      WHERE session_row.tenant_id=$1 AND session_row.room_id=$2 AND session_row.status='SCHEDULED' AND run.capacity>$3 LIMIT 1`,
      [scope.tenant.tenantId, id, input.capacity],
    );
    if (tooSmall.rowCount)
      throw new DomainError("CONFLICT", "ROOM_CAPACITY_CONFLICT");
    const result = await client.query(
      `UPDATE rooms SET venue_id=$3,name=$4,capacity=$5,description=$6,active=$7,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [
        scope.tenant.tenantId,
        id,
        input.venueId,
        input.name,
        input.capacity,
        input.description,
        input.active,
      ],
    );
    await audit(client, scope, "room.updated", "ROOM", id);
    return result.rows[0];
  });
}

async function requireInstructors(
  client: PoolClient,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  if (new Set(ids).size !== ids.length)
    throw new DomainError(
      "VALIDATION_FAILED",
      "Instructor assignments must be unique.",
    );
  if (ids.length === 0) return;
  const found = await client.query<{ user_id: string }>(
    `SELECT profile.user_id FROM tenant_instructor_profiles profile
     JOIN tenant_users user_row ON user_row."tenantId"=profile.tenant_id AND user_row.id=profile.user_id
     WHERE profile.tenant_id=$1 AND profile.user_id=ANY($2::varchar[]) AND user_row.status='ACTIVE'`,
    [tenantId, ids],
  );
  if (found.rowCount !== ids.length)
    throw new DomainError(
      "NOT_FOUND",
      "An instructor is unavailable in this tenant.",
    );
}

export async function listRuns(scope: Scope): Promise<Row[]> {
  assertScope(scope, "program.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT run.*, program.title AS program_title,
       (SELECT count(*)::int FROM program_sessions session_row WHERE session_row.tenant_id=run.tenant_id AND session_row.run_id=run.id AND session_row.status <> 'CANCELLED') AS session_count,
       COALESCE((SELECT json_agg(json_build_object('id', usr.id, 'name', usr.name))
         FROM run_instructors ri JOIN tenant_users usr ON usr."tenantId"=ri.tenant_id AND usr.id=ri.instructor_id
         WHERE ri.tenant_id=run.tenant_id AND ri.run_id=run.id), '[]') AS instructors
     FROM program_runs run JOIN programs program ON program.tenant_id=run.tenant_id AND program.id=run.program_id
     WHERE run.tenant_id=$1 AND ($2::boolean OR EXISTS (
       SELECT 1 FROM run_instructors ri WHERE ri.tenant_id=run.tenant_id AND ri.run_id=run.id AND ri.instructor_id=$3)
       OR EXISTS (SELECT 1 FROM program_sessions s JOIN session_instructors si ON si.tenant_id=s.tenant_id AND si.session_id=s.id
         WHERE s.tenant_id=run.tenant_id AND s.run_id=run.id AND si.instructor_id=$3))
     ORDER BY run.starts_at DESC LIMIT 200`,
    [scope.tenant.tenantId, broadRead(scope.actor), scope.actor.id],
  );
  return result.rows;
}

export async function getRun(scope: Scope, id: string): Promise<Row> {
  assertScope(scope, "program.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT r.* FROM program_runs r WHERE r.tenant_id=$1 AND r.id=$2
    AND ($3::boolean OR EXISTS (SELECT 1 FROM run_instructors ri WHERE ri.tenant_id=r.tenant_id AND ri.run_id=r.id AND ri.instructor_id=$4)
      OR EXISTS (SELECT 1 FROM program_sessions s JOIN session_instructors si ON si.tenant_id=s.tenant_id AND si.session_id=s.id
        WHERE s.tenant_id=r.tenant_id AND s.run_id=r.id AND si.instructor_id=$4))`,
    [scope.tenant.tenantId, id, broadRead(scope.actor), scope.actor.id],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Run not found.");
  return result.rows[0];
}

export async function createRun(scope: Scope, input: RunInput): Promise<Row> {
  assertScope(scope, "program.create");
  if (input.instructorIds.length) assertScope(scope, "instructor.manage");
  return transaction(scope, async (client) => {
    const program = await client.query<{ status: string }>(
      "SELECT status FROM programs WHERE tenant_id=$1 AND id=$2",
      [scope.tenant.tenantId, input.programId],
    );
    if (!program.rows[0] || program.rows[0].status === "ARCHIVED")
      throw new DomainError("NOT_FOUND", "Program not found or archived.");
    if (input.venueId) {
      const venue = await client.query(
        "SELECT id FROM venues WHERE tenant_id=$1 AND id=$2 AND active",
        [scope.tenant.tenantId, input.venueId],
      );
      if (!venue.rowCount)
        throw new DomainError("NOT_FOUND", "Venue not found.");
    }
    await requireInstructors(
      client,
      scope.tenant.tenantId,
      input.instructorIds,
    );
    const result = await client.query(
      `INSERT INTO program_runs (tenant_id,program_id,title,starts_at,ends_at,registration_starts_at,registration_ends_at,
         delivery_mode,capacity,minimum_capacity,waitlist_enabled,venue_id,notes,created_by,price_amount,price_currency,
         seo_title,seo_description,canonical_path,og_image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [
        scope.tenant.tenantId,
        input.programId,
        input.title,
        input.startsAt,
        input.endsAt,
        input.registrationStartsAt,
        input.registrationEndsAt,
        input.deliveryMode,
        input.capacity,
        input.minimumCapacity,
        input.waitlistEnabled,
        input.venueId,
        input.notes,
        scope.actor.id,
        input.priceAmount,
        input.priceCurrency,
        input.seoTitle ?? "",
        input.seoDescription ?? "",
        input.canonicalPath ?? "",
        input.ogImageUrl ?? "",
      ],
    );
    const row = result.rows[0];
    for (const [index, id] of input.instructorIds.entries()) {
      await client.query(
        "INSERT INTO run_instructors (tenant_id,run_id,instructor_id,is_lead) VALUES ($1,$2,$3,$4)",
        [scope.tenant.tenantId, row.id, id, index === 0],
      );
      await audit(client, scope, "instructor.assigned", "PROGRAM_RUN", row.id);
    }
    await audit(client, scope, "program_run.created", "PROGRAM_RUN", row.id);
    return row;
  });
}

export async function updateRun(
  scope: Scope,
  id: string,
  input: RunInput,
): Promise<Row> {
  assertScope(scope, "program.update");
  if (input.instructorIds.length) assertScope(scope, "instructor.manage");
  return transaction(scope, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`eventos-schedule:${scope.tenant.tenantId}`],
    );
    const current = await client.query<{ program_id: string; state: string }>(
      "SELECT program_id,state FROM program_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, id],
    );
    if (!current.rows[0]) throw new DomainError("NOT_FOUND", "Run not found.");
    if (
      current.rows[0].program_id !== input.programId ||
      ["CANCELLED", "COMPLETED"].includes(current.rows[0].state)
    )
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Run cannot be edited.",
      );
    const outside = await client.query(
      "SELECT id FROM program_sessions WHERE tenant_id=$1 AND run_id=$2 AND status='SCHEDULED' AND (starts_at<$3 OR ends_at>$4) LIMIT 1",
      [scope.tenant.tenantId, id, input.startsAt, input.endsAt],
    );
    if (outside.rowCount)
      throw new DomainError(
        "CONFLICT",
        "Existing sessions are outside the proposed run dates.",
      );
    const capacity = await client.query(
      "SELECT session_row.id FROM program_sessions session_row JOIN rooms room ON room.tenant_id=session_row.tenant_id AND room.id=session_row.room_id WHERE session_row.tenant_id=$1 AND session_row.run_id=$2 AND session_row.status='SCHEDULED' AND room.capacity<$3 LIMIT 1",
      [scope.tenant.tenantId, id, input.capacity],
    );
    if (capacity.rowCount)
      throw new DomainError("CONFLICT", "ROOM_CAPACITY_CONFLICT");
    if (input.venueId) {
      const venue = await client.query(
        "SELECT id FROM venues WHERE tenant_id=$1 AND id=$2 AND active",
        [scope.tenant.tenantId, input.venueId],
      );
      if (!venue.rowCount)
        throw new DomainError("NOT_FOUND", "Venue not found.");
    }
    await requireInstructors(
      client,
      scope.tenant.tenantId,
      input.instructorIds,
    );
    const result = await client.query(
      `UPDATE program_runs SET title=$3,starts_at=$4,ends_at=$5,registration_starts_at=$6,registration_ends_at=$7,
      delivery_mode=$8,capacity=$9,minimum_capacity=$10,waitlist_enabled=$11,venue_id=$12,notes=$13,
      price_amount=$14,price_currency=$15,seo_title=$16,seo_description=$17,
      canonical_path=$18,og_image_url=$19,updated_at=now()
      WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [
        scope.tenant.tenantId,
        id,
        input.title,
        input.startsAt,
        input.endsAt,
        input.registrationStartsAt,
        input.registrationEndsAt,
        input.deliveryMode,
        input.capacity,
        input.minimumCapacity,
        input.waitlistEnabled,
        input.venueId,
        input.notes,
        input.priceAmount,
        input.priceCurrency,
        input.seoTitle ?? "",
        input.seoDescription ?? "",
        input.canonicalPath ?? "",
        input.ogImageUrl ?? "",
      ],
    );
    await client.query(
      "DELETE FROM run_instructors WHERE tenant_id=$1 AND run_id=$2",
      [scope.tenant.tenantId, id],
    );
    for (const [index, instructorId] of input.instructorIds.entries()) {
      await client.query(
        "INSERT INTO run_instructors (tenant_id,run_id,instructor_id,is_lead) VALUES ($1,$2,$3,$4)",
        [scope.tenant.tenantId, id, instructorId, index === 0],
      );
      await audit(client, scope, "instructor.assigned", "PROGRAM_RUN", id);
    }
    await audit(client, scope, "program_run.updated", "PROGRAM_RUN", id);
    return result.rows[0];
  });
}

export async function transitionRun(
  scope: Scope,
  id: string,
  target: "PRIVATE" | "PUBLISHED" | "CANCELLED" | "COMPLETED",
): Promise<Row> {
  assertScope(
    scope,
    target === "PUBLISHED" ? "program.publish" : "session.manage",
  );
  return transaction(scope, async (client) => {
    const current = await client.query<{
      state: string;
      program_id: string;
      starts_at: Date;
      ends_at: Date;
    }>(
      "SELECT state,program_id,starts_at,ends_at FROM program_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, id],
    );
    const row = current.rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Run not found.");
    if (!mayTransition(row.state, target, runTransitions))
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Run state cannot change this way.",
      );
    if (target === "PUBLISHED") {
      const program = await client.query<{ status: string }>(
        "SELECT status FROM programs WHERE tenant_id=$1 AND id=$2",
        [scope.tenant.tenantId, row.program_id],
      );
      const sessions = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM program_sessions WHERE tenant_id=$1 AND run_id=$2 AND status='SCHEDULED'",
        [scope.tenant.tenantId, id],
      );
      if (program.rows[0]?.status !== "ACTIVE" || !sessions.rows[0]?.count) {
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Activate the program and schedule a session before publishing.",
        );
      }
    }
    const updated = await client.query(
      "UPDATE program_runs SET state=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
      [scope.tenant.tenantId, id, target],
    );
    await audit(
      client,
      scope,
      target === "PUBLISHED"
        ? "program_run.published"
        : target === "CANCELLED"
          ? "program_run.cancelled"
          : "program_run.updated",
      "PROGRAM_RUN",
      id,
    );
    return updated.rows[0];
  });
}

export async function listSessions(
  scope: Scope,
  start?: Date,
  end?: Date,
): Promise<Row[]> {
  assertScope(scope, "session.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT session_row.*, run.title AS run_title, program.title AS program_title,
       room.name AS room_name, venue.name AS venue_name,
       COALESCE((SELECT json_agg(json_build_object('id',usr.id,'name',usr.name))
         FROM session_instructors si JOIN tenant_users usr ON usr."tenantId"=si.tenant_id AND usr.id=si.instructor_id
         WHERE si.tenant_id=session_row.tenant_id AND si.session_id=session_row.id),'[]') AS instructors
     FROM program_sessions session_row
     JOIN program_runs run ON run.tenant_id=session_row.tenant_id AND run.id=session_row.run_id
     JOIN programs program ON program.tenant_id=run.tenant_id AND program.id=run.program_id
     LEFT JOIN rooms room ON room.tenant_id=session_row.tenant_id AND room.id=session_row.room_id
     LEFT JOIN venues venue ON venue.tenant_id=session_row.tenant_id AND venue.id=session_row.venue_id
     WHERE session_row.tenant_id=$1 AND ($2::timestamptz IS NULL OR session_row.ends_at>$2)
       AND ($3::timestamptz IS NULL OR session_row.starts_at<$3)
       AND ($4::boolean OR EXISTS (SELECT 1 FROM session_instructors si
         WHERE si.tenant_id=session_row.tenant_id AND si.session_id=session_row.id AND si.instructor_id=$5))
     ORDER BY session_row.starts_at LIMIT 500`,
    [
      scope.tenant.tenantId,
      start ?? null,
      end ?? null,
      broadRead(scope.actor),
      scope.actor.id,
    ],
  );
  return result.rows;
}

export async function getSession(scope: Scope, id: string): Promise<Row> {
  assertScope(scope, "session.read");
  const result = await getTenantPool(scope.tenant).query(
    `SELECT s.* FROM program_sessions s WHERE s.tenant_id=$1 AND s.id=$2
    AND ($3::boolean OR EXISTS (SELECT 1 FROM session_instructors si WHERE si.tenant_id=s.tenant_id AND si.session_id=s.id AND si.instructor_id=$4))`,
    [scope.tenant.tenantId, id, broadRead(scope.actor), scope.actor.id],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Session not found.");
  return result.rows[0];
}

async function saveSession(
  scope: Scope,
  input: SessionInput,
  existingId?: string,
): Promise<Row> {
  assertScope(scope, "session.manage");
  if (input.instructorIds.length) assertScope(scope, "instructor.manage");
  if (input.startsAt >= input.endsAt)
    throw new DomainError("VALIDATION_FAILED", "INVALID_SESSION_TIME");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Invalid timezone.");
  }
  return transaction(scope, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`eventos-schedule:${scope.tenant.tenantId}`],
    );
    if (existingId) {
      const existing = await client.query<{ run_id: string; status: string }>(
        "SELECT run_id,status FROM program_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [scope.tenant.tenantId, existingId],
      );
      if (!existing.rows[0])
        throw new DomainError("NOT_FOUND", "Session not found.");
      if (
        existing.rows[0].run_id !== input.runId ||
        existing.rows[0].status !== "SCHEDULED"
      )
        throw new DomainError(
          "INVALID_STATE_TRANSITION",
          "Session cannot be edited.",
        );
    }
    const run = await client.query<{
      starts_at: Date;
      ends_at: Date;
      capacity: number;
      state: string;
      venue_id: string | null;
    }>(
      "SELECT starts_at,ends_at,capacity,state,venue_id FROM program_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, input.runId],
    );
    const parent = run.rows[0];
    if (!parent) throw new DomainError("NOT_FOUND", "Run not found.");
    if (["CANCELLED", "COMPLETED"].includes(parent.state))
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Run cannot accept sessions.",
      );
    if (input.startsAt < parent.starts_at || input.endsAt > parent.ends_at)
      throw new DomainError(
        "VALIDATION_FAILED",
        "Session is outside the run dates.",
      );
    const effectiveIds = input.instructorIds.length
      ? input.instructorIds
      : (
          await client.query<{ instructor_id: string }>(
            "SELECT instructor_id FROM run_instructors WHERE tenant_id=$1 AND run_id=$2 ORDER BY is_lead DESC,instructor_id",
            [scope.tenant.tenantId, input.runId],
          )
        ).rows.map((row) => row.instructor_id);
    await requireInstructors(client, scope.tenant.tenantId, effectiveIds);
    if (input.roomId) {
      const room = await client.query<{ venue_id: string; capacity: number }>(
        `SELECT room.venue_id,room.capacity FROM rooms room JOIN venues venue ON venue.tenant_id=room.tenant_id AND venue.id=room.venue_id
         WHERE room.tenant_id=$1 AND room.id=$2 AND room.active AND venue.active`,
        [scope.tenant.tenantId, input.roomId],
      );
      const selected = room.rows[0];
      if (!selected || (input.venueId && selected.venue_id !== input.venueId))
        throw new DomainError(
          "NOT_FOUND",
          "Room not found in the selected venue.",
        );
      if (selected.capacity < parent.capacity)
        throw new DomainError("CONFLICT", "ROOM_CAPACITY_CONFLICT");
    }
    if (input.roomId && input.deliveryMode === "ONLINE")
      throw new DomainError(
        "VALIDATION_FAILED",
        "Online sessions cannot reserve a room.",
      );
    const roomConflict = input.roomId
      ? await client.query(
          `SELECT id FROM program_sessions WHERE tenant_id=$1 AND room_id=$2 AND status='SCHEDULED'
       AND starts_at<$4 AND ends_at>$3 AND ($5::uuid IS NULL OR id<>$5) LIMIT 1`,
          [
            scope.tenant.tenantId,
            input.roomId,
            input.startsAt,
            input.endsAt,
            existingId ?? null,
          ],
        )
      : null;
    if (roomConflict?.rowCount)
      throw new DomainError("CONFLICT", "ROOM_SCHEDULE_CONFLICT");
    const instructorConflict = effectiveIds.length
      ? await client.query(
          `SELECT session_row.id FROM program_sessions session_row
       JOIN session_instructors si ON si.tenant_id=session_row.tenant_id AND si.session_id=session_row.id
       WHERE session_row.tenant_id=$1 AND session_row.status='SCHEDULED'
         AND si.instructor_id=ANY($2::varchar[]) AND session_row.starts_at<$4 AND session_row.ends_at>$3
         AND ($5::uuid IS NULL OR session_row.id<>$5) LIMIT 1`,
          [
            scope.tenant.tenantId,
            effectiveIds,
            input.startsAt,
            input.endsAt,
            existingId ?? null,
          ],
        )
      : null;
    if (instructorConflict?.rowCount)
      throw new DomainError("CONFLICT", "INSTRUCTOR_SCHEDULE_CONFLICT");
    const venueId = input.venueId ?? (input.roomId ? null : parent.venue_id);
    const roomVenue = input.roomId
      ? await client.query<{ venue_id: string }>(
          "SELECT venue_id FROM rooms WHERE tenant_id=$1 AND id=$2",
          [scope.tenant.tenantId, input.roomId],
        )
      : null;
    const resolvedVenueId = venueId ?? roomVenue?.rows[0]?.venue_id ?? null;
    if (resolvedVenueId) {
      const venue = await client.query(
        "SELECT id FROM venues WHERE tenant_id=$1 AND id=$2 AND active",
        [scope.tenant.tenantId, resolvedVenueId],
      );
      if (!venue.rowCount)
        throw new DomainError("NOT_FOUND", "Venue not found.");
    }
    const result = existingId
      ? await client.query(
          `UPDATE program_sessions SET title=$3,starts_at=$4,ends_at=$5,timezone=$6,delivery_mode=$7,
         venue_id=$8,room_id=$9,notes=$10,updated_at=now()
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [
            scope.tenant.tenantId,
            existingId,
            input.title,
            input.startsAt,
            input.endsAt,
            input.timezone,
            input.deliveryMode,
            resolvedVenueId,
            input.roomId,
            input.notes,
          ],
        )
      : await client.query(
          `INSERT INTO program_sessions (tenant_id,run_id,title,starts_at,ends_at,timezone,delivery_mode,venue_id,room_id,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            scope.tenant.tenantId,
            input.runId,
            input.title,
            input.startsAt,
            input.endsAt,
            input.timezone,
            input.deliveryMode,
            resolvedVenueId,
            input.roomId,
            input.notes,
            scope.actor.id,
          ],
        );
    const row = result.rows[0];
    if (existingId)
      await client.query(
        "DELETE FROM session_instructors WHERE tenant_id=$1 AND session_id=$2",
        [scope.tenant.tenantId, existingId],
      );
    for (const [index, id] of effectiveIds.entries()) {
      await client.query(
        "INSERT INTO session_instructors (tenant_id,session_id,instructor_id,is_lead) VALUES ($1,$2,$3,$4)",
        [scope.tenant.tenantId, row.id, id, index === 0],
      );
      await audit(client, scope, "instructor.assigned", "SESSION", row.id);
    }
    await audit(
      client,
      scope,
      existingId ? "session.updated" : "session.created",
      "SESSION",
      row.id,
    );
    return row;
  });
}

export async function createSession(
  scope: Scope,
  input: SessionInput,
): Promise<Row> {
  return saveSession(scope, input);
}
export async function updateSession(
  scope: Scope,
  id: string,
  input: SessionInput,
): Promise<Row> {
  return saveSession(scope, input, id);
}

export async function cancelSession(scope: Scope, id: string): Promise<Row> {
  assertScope(scope, "session.manage");
  return transaction(scope, async (client) => {
    const result = await client.query(
      `UPDATE program_sessions SET status='CANCELLED',updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='SCHEDULED' RETURNING *`,
      [scope.tenant.tenantId, id],
    );
    const row = result.rows[0];
    if (!row)
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "Session cannot be cancelled.",
      );
    await audit(client, scope, "session.cancelled", "SESSION", id);
    return row;
  });
}
