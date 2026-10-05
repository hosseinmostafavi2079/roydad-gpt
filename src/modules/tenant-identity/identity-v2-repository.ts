import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { getTenantPool } from "@/infrastructure/db/tenant/pool";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { getServerConfig } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import type { TenantContext } from "./auth";
import {
  defaultProfileFields,
  loginMethodsSchema,
  profileFieldsSchema,
  validateProfileValues,
  type LoginMethods,
  type ProfileField,
} from "./identity-v2-schema";
import { smsProviderRegistry } from "@/modules/sms/registry";
import { SmsDeliveryError } from "@/modules/sms/provider";
import { assertTestSmsAllowed } from "@/modules/sms/test-provider";
import {
  emailServiceAvailable,
  assertEmailServiceAvailable,
} from "@/infrastructure/auth/mailer";

export type IdentitySettings = {
  methods: LoginMethods;
  fields: ProfileField[];
  providerKey: string | null;
  configured: boolean;
  mailAvailable: boolean;
};
export async function getIdentitySettings(
  tenant: TenantContext,
): Promise<IdentitySettings> {
  const result = await getTenantPool(tenant).query<{
    login_methods: unknown;
    profile_fields: unknown;
    sms_provider_key: string | null;
    configured: boolean;
  }>(
    "SELECT login_methods,profile_fields,sms_provider_key,sms_config_ciphertext IS NOT NULL AS configured FROM tenant_identity_settings WHERE tenant_id=$1",
    [tenant.tenantId],
  );
  const row = result.rows[0];
  const mailAvailable = emailServiceAvailable();
  const settings = row
    ? {
        methods: loginMethodsSchema.parse(row.login_methods),
        fields: profileFieldsSchema.parse(row.profile_fields),
        providerKey: row.sms_provider_key,
        configured: row.configured,
      }
    : {
        methods: {
          sms_otp: tenant.features.sms,
          username_password: tenant.features.password_login,
          email_password: tenant.features.password_login && mailAvailable,
          email_otp: tenant.features.email_otp && mailAvailable,
          google: tenant.features.google_login,
        },
        fields: defaultProfileFields.map((field) => ({ ...field })),
        providerKey: null,
        configured: false,
      };
  return {
    ...settings,
    mailAvailable,
    methods: {
      ...settings.methods,
      email_password: settings.methods.email_password && mailAvailable,
      email_otp: settings.methods.email_otp && mailAvailable,
    },
  };
}
export async function isSmsProviderAllowed(
  tenant: TenantContext,
  providerKey: string,
): Promise<boolean> {
  if (!tenant.features.sms) return false;
  const result = await getControlPool().query<{ allowed: boolean }>(
    "SELECT allowed FROM tenant_sms_provider_allowlist WHERE tenant_id=$1 AND provider_key=$2",
    [tenant.tenantId, providerKey],
  );
  return result.rows[0]?.allowed === true;
}
export async function smsAvailable(
  tenant: TenantContext,
  settings: IdentitySettings,
): Promise<boolean> {
  if (
    !tenant.features.sms ||
    !settings.methods.sms_otp ||
    tenant.limits.monthly_sms <= 0
  )
    return false;
  if (process.env.SMS_TRANSPORT === "test") {
    assertTestSmsAllowed();
    return true;
  }
  return Boolean(
    settings.configured &&
      settings.providerKey &&
      (await isSmsProviderAllowed(tenant, settings.providerKey)),
  );
}
function encryptionKey() {
  const config = getServerConfig();
  return createHash("sha256")
    .update("eventos-sms-config-v1\0")
    .update(config.TENANT_BOOTSTRAP_ENCRYPTION_KEY || config.BETTER_AUTH_SECRET)
    .digest();
}
export function encryptSmsConfiguration(
  tenantId: string,
  providerKey: string,
  input: unknown,
): Buffer {
  const value = smsProviderRegistry.resolve(providerKey).validateConfig(input);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${tenantId}:${providerKey}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
export function decryptSmsConfiguration(
  tenantId: string,
  providerKey: string,
  data: Buffer,
): unknown {
  if (!Buffer.isBuffer(data) || data.length < 29 || data.length > 8192)
    throw new SmsDeliveryError("CONFIGURATION");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    data.subarray(0, 12),
  );
  cipher.setAAD(Buffer.from(`${tenantId}:${providerKey}`));
  cipher.setAuthTag(data.subarray(12, 28));
  return smsProviderRegistry
    .resolve(providerKey)
    .validateConfig(
      JSON.parse(
        Buffer.concat([
          cipher.update(data.subarray(28)),
          cipher.final(),
        ]).toString("utf8"),
      ),
    );
}
export async function identityAudit(
  tenant: TenantContext,
  actorId: string | null,
  action: string,
  requestId: string,
): Promise<void> {
  await getTenantPool(tenant).query(
    "INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1::uuid,$2,$3,'IDENTITY',$1::uuid::text,$4)",
    [tenant.tenantId, actorId, action, requestId],
  );
}
export async function identityThrottle(
  tenant: TenantContext,
  key: string,
  seconds: number,
  maximum: number,
): Promise<void> {
  const hash = createHash("sha256").update(key).digest("hex");
  const result = await getTenantPool(tenant).query<{ count: number }>(
    `INSERT INTO tenant_identity_throttles (tenant_id,key_hash,window_start,window_end,count) VALUES ($1,$2,now(),now()+($3*interval '1 second'),1)
    ON CONFLICT (tenant_id,key_hash) DO UPDATE SET window_start=CASE WHEN tenant_identity_throttles.window_end < now() THEN now() ELSE tenant_identity_throttles.window_start END,
    window_end=CASE WHEN tenant_identity_throttles.window_end < now() THEN now()+($3*interval '1 second') ELSE tenant_identity_throttles.window_end END,
    count=CASE WHEN tenant_identity_throttles.window_end < now() THEN 1 ELSE tenant_identity_throttles.count+1 END RETURNING count`,
    [tenant.tenantId, hash, seconds],
  );
  if ((result.rows[0]?.count ?? maximum + 1) > maximum)
    throw new DomainError("RATE_LIMITED", "کمی بعد دوباره تلاش کنید.");
  // Bounded retention of obsolete entries; never remove an active limit window.
  await getTenantPool(tenant).query(
    "DELETE FROM tenant_identity_throttles WHERE tenant_id=$1 AND key_hash IN (SELECT key_hash FROM tenant_identity_throttles WHERE tenant_id=$1 AND window_end < now()-interval '1 day' LIMIT 100)",
    [tenant.tenantId],
  );
}
export async function sendIdentityOtp(
  tenant: TenantContext,
  phone: string,
  code: string,
  requestId: string,
): Promise<void> {
  const settings = await getIdentitySettings(tenant);
  if (!(await smsAvailable(tenant, settings)))
    throw new SmsDeliveryError("CONFIGURATION");
  await reserveSmsBudget(tenant);
  let providerKey: string;
  let config: unknown;
  if (process.env.SMS_TRANSPORT === "test") {
    assertTestSmsAllowed();
    providerKey = "TEST";
    config = {};
  } else {
    providerKey = settings.providerKey as string;
    const result = await getTenantPool(tenant).query<{
      sms_config_ciphertext: Buffer;
    }>(
      "SELECT sms_config_ciphertext FROM tenant_identity_settings WHERE tenant_id=$1",
      [tenant.tenantId],
    );
    config = decryptSmsConfiguration(
      tenant.tenantId,
      providerKey,
      result.rows[0]?.sms_config_ciphertext ?? Buffer.alloc(0),
    );
  }
  await smsProviderRegistry
    .resolve(providerKey)
    .sendOtp({ config, phone, code, tenantId: tenant.tenantId, requestId });
  await identityAudit(tenant, null, "auth.sms_otp_requested", requestId);
}
export async function reserveSmsBudget(tenant: TenantContext): Promise<void> {
  if (tenant.limits.monthly_sms <= 0)
    throw new DomainError("LIMIT_REACHED", "ظرفیت پیامک سازمان در دسترس نیست.");
  const month = new Date().toISOString().slice(0, 7);
  await identityThrottle(
    tenant,
    `sms-budget:${month}`,
    32 * 86400,
    tenant.limits.monthly_sms,
  );
}
export async function saveIdentitySettings(
  tenant: TenantContext,
  actorId: string,
  input: { methods: LoginMethods; fields: ProfileField[] },
  requestId: string,
): Promise<IdentitySettings> {
  const methods = loginMethodsSchema.parse(input.methods);
  const fields = profileFieldsSchema.parse(input.fields);
  if (methods.email_password || methods.email_otp)
    assertEmailServiceAvailable();
  if (
    ((methods.email_password || methods.username_password) &&
      !tenant.features.password_login) ||
    (methods.email_otp && !tenant.features.email_otp) ||
    (methods.google && !tenant.features.google_login) ||
    (methods.sms_otp && !tenant.features.sms)
  )
    throw new DomainError(
      "FEATURE_DISABLED",
      "این روش ورود در طرح سازمان فعال نیست.",
    );
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `identity-settings:${tenant.tenantId}`,
    ]);
    const users = await client.query<{
      email: string;
      emailVerified: boolean;
      username: string | null;
      phoneNumberVerified: boolean;
      has_password: boolean;
    }>(
      `SELECT u.email,u."emailVerified",u.username,u."phoneNumberVerified",EXISTS(SELECT 1 FROM tenant_auth_accounts a WHERE a."userId"=u.id AND a."providerId"='credential' AND a.password IS NOT NULL) AS has_password FROM tenant_users u WHERE u."tenantId"=$1 AND u.id=$2`,
      [tenant.tenantId, actorId],
    );
    const user = users.rows[0];
    const current = await getIdentitySettings(tenant);
    const smsReady = await smsAvailable(tenant, { ...current, methods });
    const usable =
      user &&
      ((methods.email_password && user.emailVerified && user.has_password) ||
        (methods.username_password && user.username && user.has_password) ||
        (methods.email_otp &&
          user.emailVerified &&
          !user.email.endsWith("@phone.eventos.invalid")) ||
        (methods.sms_otp && user.phoneNumberVerified && smsReady));
    if (!usable)
      throw new DomainError(
        "CONFLICT",
        "ابتدا یک روش ورود جایگزین برای حساب مدیر تأیید کنید.",
      );
    await client.query(
      `INSERT INTO tenant_identity_settings (tenant_id,login_methods,profile_fields) VALUES ($1,$2::jsonb,$3::jsonb) ON CONFLICT (tenant_id) DO UPDATE SET login_methods=EXCLUDED.login_methods,profile_fields=EXCLUDED.profile_fields,updated_at=now()`,
      [tenant.tenantId, JSON.stringify(methods), JSON.stringify(fields)],
    );
    for (const action of [
      "auth.methods_updated",
      "registration_fields.updated",
    ])
      await client.query(
        "INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1::uuid,$2,$3,'IDENTITY',$1::uuid::text,$4)",
        [tenant.tenantId, actorId, action, requestId],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getIdentitySettings(tenant);
}
export async function saveSmsConfiguration(
  tenant: TenantContext,
  actorId: string,
  providerKey: string,
  config: unknown,
  requestId: string,
) {
  if (!(await isSmsProviderAllowed(tenant, providerKey)))
    throw new DomainError("FORBIDDEN", "ارائه‌دهنده مجاز نیست.");
  const settings = await getIdentitySettings(tenant);
  let merged = config;
  if (
    settings.providerKey === providerKey &&
    settings.configured &&
    config &&
    typeof config === "object" &&
    !Array.isArray(config)
  ) {
    const result = await getTenantPool(tenant).query<{
      sms_config_ciphertext: Buffer;
    }>(
      "SELECT sms_config_ciphertext FROM tenant_identity_settings WHERE tenant_id=$1",
      [tenant.tenantId],
    );
    const previous = decryptSmsConfiguration(
      tenant.tenantId,
      providerKey,
      result.rows[0]?.sms_config_ciphertext ?? Buffer.alloc(0),
    );
    merged = {
      ...(previous as Record<string, unknown>),
      ...(config as Record<string, unknown>),
    };
  }
  const ciphertext = encryptSmsConfiguration(
    tenant.tenantId,
    providerKey,
    merged,
  );
  await getTenantPool(tenant).query(
    `INSERT INTO tenant_identity_settings (tenant_id,login_methods,profile_fields,sms_provider_key,sms_config_ciphertext) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id) DO UPDATE SET sms_provider_key=EXCLUDED.sms_provider_key,sms_config_ciphertext=EXCLUDED.sms_config_ciphertext,updated_at=now()`,
    [
      tenant.tenantId,
      JSON.stringify(settings.methods),
      JSON.stringify(settings.fields),
      providerKey,
      ciphertext,
    ],
  );
  await identityAudit(tenant, actorId, "sms_provider.configured", requestId);
  return getIdentitySettings(tenant);
}

export async function getSmsConfigurationView(
  tenant: TenantContext,
): Promise<Record<string, string>> {
  const settings = await getIdentitySettings(tenant);
  if (
    !settings.providerKey ||
    !settings.configured ||
    !(await isSmsProviderAllowed(tenant, settings.providerKey))
  )
    return {};
  const result = await getTenantPool(tenant).query<{
    sms_config_ciphertext: Buffer;
  }>(
    "SELECT sms_config_ciphertext FROM tenant_identity_settings WHERE tenant_id=$1",
    [tenant.tenantId],
  );
  const config = decryptSmsConfiguration(
    tenant.tenantId,
    settings.providerKey,
    result.rows[0]?.sms_config_ciphertext ?? Buffer.alloc(0),
  ) as Record<string, unknown>;
  return Object.fromEntries(
    (
      smsProviderRegistry.resolve(settings.providerKey).configurationFields ??
      []
    )
      .filter((field) => !field.secret)
      .map((field) => [field.key, String(config[field.key] ?? "")]),
  );
}
export async function saveParticipantProfile(
  tenant: TenantContext,
  userId: string,
  input: unknown,
  mode: "signup" | "profile",
  requestId: string = randomUUID(),
) {
  const settings = await getIdentitySettings(tenant);
  let values: ReturnType<typeof validateProfileValues>;
  try {
    values = validateProfileValues(settings.fields, input, mode);
  } catch {
    throw new DomainError(
      "VALIDATION_FAILED",
      "اطلاعات پروفایل معتبر یا کامل نیست.",
    );
  }
  const {
    mobile: _mobile,
    first_name: firstName,
    last_name: lastName,
    ...custom
  } = values;
  const client = await getTenantPool(tenant).connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE tenant_participant_profiles SET first_name=COALESCE($3,first_name),last_name=COALESCE($4,last_name),profile_values=profile_values||$5::jsonb,display_name=CASE WHEN $3 IS NULL AND $4 IS NULL THEN display_name ELSE trim(COALESCE($3,first_name)||' '||COALESCE($4,last_name)) END,updated_at=now() WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id`,
      [
        tenant.tenantId,
        userId,
        firstName ?? null,
        lastName ?? null,
        JSON.stringify(custom),
      ],
    );
    if (!result.rowCount)
      throw new DomainError("NOT_FOUND", "پروفایل یافت نشد.");
    if (firstName !== undefined || lastName !== undefined)
      await client.query(
        'UPDATE tenant_users SET name=p.display_name FROM tenant_participant_profiles p WHERE tenant_users.id=$2 AND tenant_users."tenantId"=$1 AND p.user_id=tenant_users.id AND p.tenant_id=$1',
        [tenant.tenantId, userId],
      );
    await client.query(
      "INSERT INTO tenant_audit_logs (tenant_id,actor_id,action,target_type,target_id,request_id) VALUES ($1::uuid,$2,'profile.updated','IDENTITY',$1::uuid::text,$3)",
      [tenant.tenantId, userId, requestId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
