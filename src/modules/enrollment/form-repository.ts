import "server-only";

import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import type { TenantContext } from "@/modules/tenant-identity/auth";
import { authorize } from "@/modules/tenant-identity/permissions";
import type { TenantActor } from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import { registrationFormSchema } from "./form";

type Scope = { tenant: TenantContext; actor: TenantActor; requestId: string };
function assertScope(scope: Scope) {
  if (scope.tenant.tenantId !== scope.actor.tenantId)
    throw new DomainError("FORBIDDEN", "Wrong tenant.");
  authorize(scope.actor.permissions, "program.update");
  if (!scope.tenant.features.registration)
    throw new DomainError("FEATURE_DISABLED", "Registration is unavailable.");
}

export async function getRunRegistrationForm(scope: Scope, runId: string) {
  assertScope(scope);
  const result = await getTenantPool(scope.tenant).query<{
    registration_form_schema: unknown;
  }>(
    "SELECT registration_form_schema FROM program_runs WHERE tenant_id=$1 AND id=$2",
    [scope.tenant.tenantId, runId],
  );
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Run not found.");
  return registrationFormSchema.parse(result.rows[0].registration_form_schema);
}

export async function updateRunRegistrationForm(
  scope: Scope,
  runId: string,
  fields: unknown,
) {
  assertScope(scope);
  const client = await getTenantPool(scope.tenant).connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ registration_form_schema: unknown }>(
      "SELECT registration_form_schema FROM program_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenant.tenantId, runId],
    );
    if (!current.rows[0]) throw new DomainError("NOT_FOUND", "Run not found.");
    const old = registrationFormSchema.parse(
      current.rows[0].registration_form_schema,
    );
    const next = registrationFormSchema.parse({
      version: old.version + 1,
      fields,
    });
    await client.query(
      "UPDATE program_runs SET registration_form_schema=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [scope.tenant.tenantId, runId, JSON.stringify(next)],
    );
    await client.query(
      `INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id,after_state)
       VALUES ($1,$2,'registration_form.updated','PROGRAM_RUN',$3,$4,$5::jsonb)`,
      [
        scope.tenant.tenantId,
        scope.actor.id,
        runId,
        scope.requestId,
        JSON.stringify({ version: next.version }),
      ],
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
