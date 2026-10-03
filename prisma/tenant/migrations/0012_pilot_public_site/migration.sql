SET ROLE eventos_tenant_owner;

CREATE TABLE tenant_instructor_public_profiles (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id varchar(64) NOT NULL,
  slug varchar(80) NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_instructor_profiles(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX tenant_instructor_public_list_idx ON tenant_instructor_public_profiles (tenant_id, published, slug);

CREATE TABLE tenant_information_pages (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug varchar(80) NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title varchar(160) NOT NULL,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_title varchar(160) NOT NULL DEFAULT '',
  meta_description varchar(300) NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX tenant_information_page_list_idx ON tenant_information_pages (tenant_id, published);

CREATE TABLE tenant_site_entries (
  tenant_id uuid NOT NULL REFERENCES tenant_metadata(tenant_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind varchar(20) NOT NULL CHECK (kind IN ('FAQ', 'TESTIMONIAL', 'GALLERY')),
  content jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX tenant_site_entries_list_idx ON tenant_site_entries (tenant_id, kind, enabled, sort_order);

ALTER TABLE tenant_media DROP CONSTRAINT tenant_media_purpose_check;
ALTER TABLE tenant_media ADD CONSTRAINT tenant_media_purpose_check CHECK (purpose IN (
  'PROGRAM_COVER','PROGRAM_VIDEO','WEBSITE_LOGO','WEBSITE_FAVICON','WEBSITE_HERO','WEBSITE_ABOUT','WEBSITE_SOCIAL',
  'INSTRUCTOR_PHOTO','INSTRUCTOR_RESUME','WEBSITE_GALLERY'
));

RESET ROLE;
