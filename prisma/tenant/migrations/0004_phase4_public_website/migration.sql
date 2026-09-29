SET ROLE eventos_tenant_owner;

CREATE TABLE tenant_website_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  display_name varchar(160) NOT NULL DEFAULT '',
  short_description varchar(500) NOT NULL DEFAULT '',
  about text NOT NULL DEFAULT '',
  logo_url varchar(2048) NOT NULL DEFAULT '',
  cover_url varchar(2048) NOT NULL DEFAULT '',
  favicon_url varchar(2048) NOT NULL DEFAULT '',
  phone varchar(40) NOT NULL DEFAULT '',
  email varchar(320) NOT NULL DEFAULT '',
  address varchar(500) NOT NULL DEFAULT '',
  website_url varchar(2048) NOT NULL DEFAULT '',
  social_url varchar(2048) NOT NULL DEFAULT '',
  contact_hours varchar(200) NOT NULL DEFAULT '',
  footer_description varchar(500) NOT NULL DEFAULT '',
  primary_color varchar(7) NOT NULL DEFAULT '#0e766e',
  secondary_color varchar(7) NOT NULL DEFAULT '#174b48',
  accent_color varchar(7) NOT NULL DEFAULT '#d39b45',
  hero_enabled boolean NOT NULL DEFAULT true,
  featured_enabled boolean NOT NULL DEFAULT true,
  about_enabled boolean NOT NULL DEFAULT true,
  contact_enabled boolean NOT NULL DEFAULT true,
  card_style varchar(16) NOT NULL DEFAULT 'SOFT' CHECK (card_style IN ('SOFT','OUTLINED')),
  radius_style varchar(16) NOT NULL DEFAULT 'MEDIUM' CHECK (radius_style IN ('SMALL','MEDIUM','LARGE')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenant_website_profiles (tenant_id)
SELECT tenant_id FROM tenant_metadata
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO tenant_permissions (tenant_id, key, module, name, description, high_risk)
SELECT tenant_id, 'website.manage', 'website', 'Manage public website',
       'Edit the organization public profile and theme.', false
FROM tenant_metadata ON CONFLICT (tenant_id, key) DO NOTHING;
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, 'website.manage'
FROM tenant_roles AS role
WHERE role.code IN ('organization_owner', 'organization_admin')
ON CONFLICT DO NOTHING;

RESET ROLE;
