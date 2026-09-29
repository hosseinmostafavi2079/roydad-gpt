import "server-only";

import { DomainError } from "@/shared/errors/domain-error";
import { appendAuditRecord } from "@/modules/platform/audit/repository";
import type { PlatformActor } from "@/infrastructure/auth/platform-session";
import { withControlTransaction } from "@/infrastructure/db/control/transaction";
import type {
  CreatePlanInput,
  UpdatePlanInput,
} from "@/modules/platform/plans/schema";

type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  created_at: Date;
  updated_at: Date;
};

function toPlanDto(row: PlanRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    features: row.features,
    limits: row.limits,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listPlans() {
  const { getControlPool } = await import("@/infrastructure/db/control/pool");
  const result = await getControlPool().query<PlanRow>(
    `SELECT id, code, name, description, is_active, features, limits, created_at, updated_at
     FROM plans
     ORDER BY is_active DESC, name ASC, id ASC`,
  );
  return result.rows.map(toPlanDto);
}

export async function createPlan(
  input: CreatePlanInput,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const result = await client.query<PlanRow>(
      `INSERT INTO plans (code, name, description, is_active, features, limits)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       RETURNING id, code, name, description, is_active, features, limits, created_at, updated_at`,
      [
        input.code,
        input.name,
        input.description,
        input.isActive,
        JSON.stringify(input.features),
        JSON.stringify(input.limits),
      ],
    );
    const plan = result.rows[0];
    if (!plan) {
      throw new Error("Plan insert did not return a row.");
    }
    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "plan.created",
      targetType: "PLAN",
      targetId: plan.id,
      requestId,
      afterState: {
        code: plan.code,
        name: plan.name,
        isActive: plan.is_active,
      },
    });
    return toPlanDto(plan);
  });
}

export async function updatePlan(
  planId: string,
  input: UpdatePlanInput,
  actor: PlatformActor,
  requestId: string,
) {
  return withControlTransaction(async (client) => {
    const current = await client.query<PlanRow>(
      `SELECT id, code, name, description, is_active, features, limits, created_at, updated_at
       FROM plans WHERE id = $1 FOR UPDATE`,
      [planId],
    );
    const previous = current.rows[0];
    if (!previous) {
      throw new DomainError("NOT_FOUND", "The requested plan was not found.");
    }

    const updated = await client.query<PlanRow>(
      `UPDATE plans
       SET name = $2, description = $3, is_active = $4,
           features = $5::jsonb, limits = $6::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, code, name, description, is_active, features, limits, created_at, updated_at`,
      [
        planId,
        input.name,
        input.description,
        input.isActive,
        JSON.stringify(input.features),
        JSON.stringify(input.limits),
      ],
    );
    const plan = updated.rows[0];
    if (!plan) {
      throw new Error("Plan update did not return a row.");
    }

    await appendAuditRecord(client, {
      actorType: "PLATFORM_ADMIN",
      actorId: actor.adminId,
      action: "plan.updated",
      targetType: "PLAN",
      targetId: plan.id,
      requestId,
      beforeState: {
        name: previous.name,
        isActive: previous.is_active,
        features: previous.features,
        limits: previous.limits,
      },
      afterState: {
        name: plan.name,
        isActive: plan.is_active,
        features: plan.features,
        limits: plan.limits,
      },
    });
    return toPlanDto(plan);
  });
}
