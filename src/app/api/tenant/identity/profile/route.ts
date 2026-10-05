import { z } from "zod";
import { withTenantRoute, parseJson } from "@/shared/http/tenant-route";
import {
  getIdentitySettings,
  saveParticipantProfile,
} from "@/modules/tenant-identity/identity-v2-repository";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { DomainError } from "@/shared/errors/domain-error";

export function GET(request: Request) {
  return withTenantRoute(request, async ({ tenant }, actor) => {
    const settings = await getIdentitySettings(tenant);
    const result = await getTenantPool(tenant).query<{
      first_name: string;
      last_name: string;
      profile_values: Record<string, unknown>;
      phoneNumber: string | null;
      username: string | null;
    }>(
      `SELECT p.first_name,p.last_name,p.profile_values,u."phoneNumber",u.username FROM tenant_participant_profiles p JOIN tenant_users u ON u.id=p.user_id AND u."tenantId"=p.tenant_id WHERE p.tenant_id=$1 AND p.user_id=$2`,
      [tenant.tenantId, actor.id],
    );
    if (!result.rows[0])
      throw new DomainError("NOT_FOUND", "پروفایل یافت نشد.");
    const row = result.rows[0];
    const all = {
      ...row.profile_values,
      first_name: row.first_name,
      last_name: row.last_name,
      mobile: row.phoneNumber ?? "",
    };
    const fields = settings.fields.filter(
      (field) => field.enabled && field.showInProfile,
    );
    return {
      fields,
      values: Object.fromEntries(
        fields.map((field) => [
          field.key,
          all[field.key as keyof typeof all] ??
            (field.type === "CHECKBOX"
              ? false
              : field.type === "MULTI_SELECT"
                ? []
                : ""),
        ]),
      ),
      username: row.username,
      usernameEnabled:
        settings.methods.username_password && tenant.features.password_login,
    };
  });
}
export function PATCH(request: Request) {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) => {
      const input = await parseJson(
        request,
        z.strictObject({ values: z.record(z.string(), z.unknown()) }),
      );
      await saveParticipantProfile(
        tenant,
        actor.id,
        input.values,
        "profile",
        requestId,
      );
      return { success: true };
    },
    undefined,
    { mutation: true },
  );
}
