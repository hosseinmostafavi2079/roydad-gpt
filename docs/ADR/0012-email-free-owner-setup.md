# ADR 0012 — email-free initial owner activation

Status: accepted for C1.2.

Initial tenant provisioning must work when SMTP is disabled. A reusable temporary password would require a broader first-login change guard. Instead, use a one-time activation setup: provision the owner with an unusable credential, deliver a random tenant-bound activation code to an authorized platform admin once, and require the owner to choose their password before any session is issued. Existing username/mobile validation, encrypted bootstrap, Argon2id hashing, verification storage, CSRF, hostname resolution and throttling are reused. Normal invitations are unchanged.

A forward-only nullable password-setup timestamp marks this specific authentication proof. The username session hook permits an unverified-contact exception only for this marker together with the organization-owner role; it does not mark phone/email verified or relax participant authentication. The control migration adds a short-lived encrypted handoff. Its claim transaction removes the ciphertext and audits without secrets.

Consequences: codes expire in 24 hours; retrieval cannot be repeated after refresh or delivery failure. Lost/expired access requires an authorized operator-assisted recovery procedure. No public recovery fallback or SMS invitation feature is introduced. Historical control/tenant migrations remain immutable.
