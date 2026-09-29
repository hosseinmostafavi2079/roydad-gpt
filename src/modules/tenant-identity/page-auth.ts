import "server-only";

import { notFound, redirect } from "next/navigation";
import { DomainError } from "@/shared/errors/domain-error";
import { requireTenantPageActor } from "@/modules/tenant-identity/request-auth";

export async function requireTenantPage(permission?: string) {
  try {
    const result = await requireTenantPageActor(permission);
    if (
      !result.tenant.features.crm &&
      ["instructor.read", "participant.read"].includes(permission ?? "")
    ) {
      notFound();
    }
    return result;
  } catch (error) {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED")
      redirect("/login");
    if (
      error instanceof DomainError &&
      ["FORBIDDEN", "NOT_FOUND", "TENANT_NOT_ACTIVE"].includes(error.code)
    )
      notFound();
    throw error;
  }
}
