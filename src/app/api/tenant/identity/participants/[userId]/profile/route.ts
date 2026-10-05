import { z } from "zod";
import { withTenantRoute } from "@/shared/http/tenant-route";
import { getIdentitySettings } from "@/modules/tenant-identity/identity-v2-repository";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { DomainError } from "@/shared/errors/domain-error";
export function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  return withTenantRoute(
    request,
    async ({ tenant }, actor) => {
      const { userId } = await context.params;
      const id = z.string().max(64).parse(userId);
      const result = await getTenantPool(tenant).query<{
        first_name: string;
        last_name: string;
        profile_values: Record<string, unknown>;
        phoneNumber: string | null;
      }>(
        `SELECT p.first_name,p.last_name,p.profile_values,u."phoneNumber" FROM tenant_participant_profiles p JOIN tenant_users u ON u.id=p.user_id AND u."tenantId"=p.tenant_id WHERE p.tenant_id=$1 AND p.user_id=$2`,
        [tenant.tenantId, id],
      );
      if (!result.rows[0])
        throw new DomainError("NOT_FOUND", "پروفایل یافت نشد.");
      const row = result.rows[0];
      const values: Record<string, unknown> = {
        ...row.profile_values,
        first_name: row.first_name,
        last_name: row.last_name,
        mobile: row.phoneNumber ?? "",
      };
      return (await getIdentitySettings(tenant)).fields
        .filter(
          (field) =>
            field.enabled &&
            field.adminVisible &&
            (field.key !== "national_id" ||
              actor.permissions.has("participant.sensitive.read")),
        )
        .map((field) => ({
          key: field.key,
          label: field.label,
          value: values[field.key] ?? "",
        }));
    },
    "participant.read",
    { feature: "crm" },
  );
}
