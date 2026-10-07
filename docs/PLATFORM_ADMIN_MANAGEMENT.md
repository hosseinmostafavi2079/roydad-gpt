# Platform Super Admin management

Additional full Super Admins are created at `/platform/admins` by an ACTIVE
platform admin. Public signup remains disabled; initial production bootstrap
remains initial-only. Migration `0016_platform_admin_management.sql` backfills
existing administrators and preserves bootstrap defaults. Managed new accounts
explicitly start with `activated_at = NULL` and no credential account.

The creator securely shares a one-time, 256-bit activation code separately.
No email is sent. Codes expire in 24 hours; only SHA-256 hashes are stored.
Regeneration invalidates the previous code. `/platform-activation` and its API
are canonical-platform-host-only; same-origin POST requires a personal password
of 24–128 characters with confirmation. Passwords use the existing Argon2 helper.
Activation is transactional and does not sign in automatically. Normal sign-in
and `PLATFORM_REQUIRE_MFA` continue governing access.

Activation also replaces any credential created through recovery while the
identity was still pending and removes preactivation sessions. The activation
password is authoritative and a fresh normal sign-in is always required.

Five failed code attempts lock the record for 15 minutes. A persistent, fixed
100-attempt/minute global bucket also bounds unknown-email attempts without
storing submitted identifiers. Invalid, expired and locked codes return the same
generic message. Codes/passwords never enter audit records, URLs or browser storage.
One-time responses are no-store and the UI clears its code state when closed.

Lifecycle mutations serialize with a transaction advisory lock and recheck the
acting administrator. Revocation cannot remove the last ACTIVE admin, including
concurrent/self revocation. Sessions and pending codes are invalidated immediately.
Reactivating a formerly active admin preserves credentials/MFA and restores no
sessions. A revoked unactivated admin receives a fresh code and returns to pending.
Session-only revocation preserves lifecycle, credentials and MFA.

The list returns bounded safe summaries; no credentials, activation hashes,
session tokens or MFA secrets are exposed. All six actions append safe audit
records. No role hierarchy or permanent deletion is provided in this step.
