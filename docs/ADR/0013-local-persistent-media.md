# ADR 0013 — local persistent media for the initial Windows pilot

Status: accepted for C1.3.

Use an explicit provider-neutral put/get/delete boundary. General installations retain the S3 default; the Windows/IIS profile selects local storage in the app-only `eventos-production_media` volume at `/app/data/media`. Database object keys and authorized media/certificate routes remain unchanged. No schema migration or browser-visible change is required.

Local writes are private and atomic. Keys are validated before directory creation; symlinks, junctions and hard links are rejected. Linux operations retain directory descriptors and do not follow links; Windows development supports canonical 8.3 aliases under a private root. Files are not executable or exposed by a static/IIS alias. MIME, signature, size, quota and tenant authorization remain in their existing business/route layers.

Consequences: this is a single-server storage backend, not shared horizontal storage. Volume ownership, host physical free-space monitoring, quiesced backups and isolated restore exercises are operator responsibilities. Backup includes only the exact EventOS mount and fails on media errors. A dry-run default migration utility conditionally uploads to S3, verifies bytes/checksums, resumes by comparing existing objects, and never deletes local data or changes configuration. Operators explicitly switch drivers only after a successful quiesced verification pass.
