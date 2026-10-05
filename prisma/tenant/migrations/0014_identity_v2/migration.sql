ALTER TABLE tenant_users ADD COLUMN "phoneNumber" varchar(16), ADD COLUMN "phoneNumberVerified" boolean NOT NULL DEFAULT false, ADD COLUMN username varchar(30);
WITH candidates AS (
 SELECT id, regexp_replace(regexp_replace(translate(mobile,'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),'[[:space:]()-]','','g'),'^(\+98|0098|0)','') AS local_phone
 FROM tenant_users WHERE mobile IS NOT NULL AND "mobileVerifiedAt" IS NOT NULL
) UPDATE tenant_users u SET "phoneNumber"='+98'||c.local_phone,"phoneNumberVerified"=(u."mobileVerifiedAt" IS NOT NULL) FROM candidates c WHERE u.id=c.id AND c.local_phone ~ '^9[0-9]{9}$';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM tenant_users WHERE "phoneNumber" IS NOT NULL GROUP BY "tenantId","phoneNumber" HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Identity migration requires review: conflicting canonical mobile identities';
 END IF;
END $$;
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_phone_canonical CHECK ("phoneNumber" IS NULL OR "phoneNumber" ~ '^\+989[0-9]{9}$');
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_username_canonical CHECK (username IS NULL OR (username = lower(username) AND username ~ '^[a-z][a-z0-9_]{2,29}$' AND username NOT IN ('admin','root','system','support','eventos','administrator')));
CREATE UNIQUE INDEX tenant_users_phone_unique ON tenant_users ("tenantId", "phoneNumber");
CREATE UNIQUE INDEX tenant_users_username_unique ON tenant_users ("tenantId", username);
ALTER TABLE tenant_participant_profiles ADD COLUMN first_name varchar(120) NOT NULL DEFAULT '', ADD COLUMN last_name varchar(120) NOT NULL DEFAULT '', ADD COLUMN profile_values jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(profile_values::text) <= 20000);
CREATE TABLE tenant_identity_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  login_methods jsonb NOT NULL CHECK (jsonb_typeof(login_methods) = 'object'),
  profile_fields jsonb NOT NULL CHECK (jsonb_typeof(profile_fields) = 'array' AND jsonb_array_length(profile_fields) <= 40),
  sms_provider_key varchar(40), sms_config_ciphertext bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_identity_throttles (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  key_hash char(64) NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id,key_hash)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_identity_settings, tenant_identity_throttles TO eventos_tenant_runtime;
INSERT INTO tenant_permissions (tenant_id,key,module,name,description,high_risk) SELECT tenant_id,'participant.sensitive.read','participant','Read sensitive participant fields','Read explicitly enabled sensitive participant fields',true FROM tenant_metadata;
INSERT INTO tenant_role_permissions (tenant_id,role_id,permission_key) SELECT tenant_id,id,'participant.sensitive.read' FROM tenant_roles WHERE code='organization_owner';
