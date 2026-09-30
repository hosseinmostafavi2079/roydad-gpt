SET ROLE eventos_tenant_owner;

CREATE TABLE tenant_media (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purpose varchar(32) NOT NULL CHECK (purpose IN ('PROGRAM_COVER','PROGRAM_VIDEO','WEBSITE_LOGO','WEBSITE_FAVICON','WEBSITE_HERO','WEBSITE_ABOUT','WEBSITE_SOCIAL')),
  resource_id uuid NOT NULL,
  object_key varchar(300) NOT NULL,
  content_type varchar(32) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, purpose, resource_id),
  UNIQUE (object_key)
);
CREATE INDEX tenant_media_usage_idx ON tenant_media (tenant_id, purpose);

ALTER TABLE tenant_website_profiles ADD COLUMN site_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE tenant_website_profiles SET site_settings = jsonb_build_object(
  'sections', jsonb_build_object(
    'hero', hero_enabled, 'featured', featured_enabled, 'upcoming', false,
    'about', about_enabled, 'instructors', false, 'stats', false,
    'contact', contact_enabled, 'social', false, 'newsletter', false
  )
);

RESET ROLE;
