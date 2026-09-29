import { z } from "zod";
import { listManagedEnrollments } from "@/modules/enrollment/repository";
import { authorize } from "@/modules/tenant-identity/permissions";
import {
  requireTenantActor,
  resolveTenantRequest,
} from "@/modules/tenant-identity/request-auth";
import { DomainError } from "@/shared/errors/domain-error";
import { errorResponse } from "@/shared/http/api-response";

export const runtime = "nodejs";

function cell(value: unknown): string {
  const raw = String(value ?? "").replace(/^[\s\uFEFF]*([=+@-])/, "'$1");
  return `"${raw.replaceAll('"', '""')}"`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { tenant, origin } = await resolveTenantRequest(request);
    const actor = await requireTenantActor(tenant, origin, request.headers);
    authorize(actor.permissions, "enrollment.read");
    if (!tenant.features.registration)
      throw new DomainError("FEATURE_DISABLED", "Registration is unavailable.");
    const value = new URL(request.url).searchParams.get("runId");
    const runId = value ? z.uuid().parse(value) : undefined;
    const entries = await listManagedEnrollments(
      { tenant, actor, requestId: "enrollments-export" },
      runId,
    );
    const rows = [
      ["نام", "ایمیل", "برنامه", "وضعیت", "تاریخ ثبت‌نام"].map(cell).join(","),
      ...entries.map((entry) =>
        [
          entry.name,
          entry.email,
          entry.run_title,
          entry.status,
          new Date(String(entry.registered_at)).toISOString(),
        ]
          .map(cell)
          .join(","),
      ),
    ];
    return new Response(`\uFEFF${rows.join("\r\n")}\r\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=enrollments.csv",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
