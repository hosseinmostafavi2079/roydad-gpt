SET ROLE eventos_tenant_owner;

ALTER TABLE program_runs
  ADD COLUMN seo_title varchar(160) NOT NULL DEFAULT '',
  ADD COLUMN seo_description varchar(300) NOT NULL DEFAULT '',
  ADD COLUMN canonical_path varchar(100) NOT NULL DEFAULT '',
  ADD COLUMN og_image_url varchar(80) NOT NULL DEFAULT '';

RESET ROLE;
