import "server-only";

import type { PoolClient } from "pg";

export type AuditInput = Readonly<{
  actorType: "PLATFORM_ADMIN" | "SYSTEM";
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}>;

export async function appendAuditRecord(
  client: PoolClient,
  input: AuditInput,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_logs
       (actor_type, actor_id, action, target_type, target_id, before_state, after_state, request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      input.actorType,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
      input.requestId,
    ],
  );
}
