ALTER TABLE tenants
  ADD COLUMN creation_request_key uuid,
  ADD COLUMN creation_payload_hash char(64);

CREATE UNIQUE INDEX tenants_creation_request_unique
  ON tenants (created_by, creation_request_key)
  WHERE creation_request_key IS NOT NULL;

ALTER TABLE tenants ADD CONSTRAINT tenants_creation_request_pair
  CHECK ((creation_request_key IS NULL) = (creation_payload_hash IS NULL));
