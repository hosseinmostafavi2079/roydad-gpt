# ADR 0011: Attendance and certificate foundation

Status: implemented locally, release pending quality gates.

The requested Phase 5 introduces attendance and certificates before commerce. The original master brief labels these operations Phase 6; the direct request controls this slice. Payments remain deferred.

Use the existing `attendance`, `qr_attendance`, and `certificates` plan/tenant flags as the only feature switches. A second set of `*_enabled` columns would allow conflicting states. Resolve the trusted tenant and current grants at every protected route and service, then enforce session assignment or participant ownership at the record level.

Store attendance and QR replay state in the tenant database with composite tenant foreign keys. Sign a 90-second QR challenge using a key derived from the server auth secret, and redeem in a transaction with unique-use and unique attendance constraints. Store controlled certificate templates as typed JSON, images and generated PDFs as private S3 objects, and random verification codes in tenant-local metadata. The public verifier exposes only minimal active-certificate information and uses a tenant-local request limit. Serial and verification codes are generated with cryptographic randomness. Issuance is idempotent for each tenant/run/participant, and revocation preserves audit history.

The tradeoff is that certificate issuance performs PDF generation and object upload while holding a tenant transaction. This serializes storage quota and duplicate-issue decisions but lengthens the transaction; large backgrounds are capped at 5 MB. The issuer should move to a queued, idempotent job if throughput increases.
