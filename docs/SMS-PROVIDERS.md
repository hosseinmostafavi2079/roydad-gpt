# SMS providers and Identity V2

Kavenegar is the first adapter, not a dependency of authentication or profile business logic. `SmsProviderRegistry` selects an adapter by its stable key. `SmsProvider` declares a typed Zod configuration schema, safe configuration field metadata, capabilities, config validation and `sendOtp`. The core authentication layer never branches on a commercial provider key. Future delivery status, general message and health-check methods can be added as optional capabilities.

To add a provider, implement its adapter, schema and capability declarations, then register it in `src/modules/sms/registry.ts`. Configuration field metadata drives the settings UI; secret fields are never included in read responses. No changes to OTP verification, registration, participant profiles or Better Auth are needed. Only Kavenegar is implemented in this release; future adapters must receive their own security tests before being offered in the registry.

## Kavenegar

The adapter follows the [official REST documentation](https://kavenegar.com/rest.html): HTTPS POST to `verify/lookup.json`, form fields `receptor`, `token`, `template`, `type=sms`, and a required successful HTTP response plus provider status 200. `apiKey` and `otpTemplate` are required; `sender` is optional configuration for future general messages and is not used by VerifyLookup. The request aborts after eight seconds, does not follow redirects, and does not retry automatically. Errors discard provider response text, URLs and network exception details and become safe EventOS SMS errors. The key, code and authorization URL must never be logged.

Super Admin enables the existing SMS platform feature and grants provider allowance at `/api/platform/tenants/:tenantId/sms-providers`. Tenant Admin configures only an allowed provider under Settings → Login and registration → SMS. AES-256-GCM uses a domain-separated key derived from the existing bootstrap encryption key and binds ciphertext to tenant ID and provider key with authenticated additional data. Production requires that dedicated encryption key. Blank secret inputs preserve a saved secret; read responses return only status and non-secret typed fields. A configuration test requires `settings.manage`, the SMS capability, an allowed configured provider, same-origin protection, and a persisted one-per-minute actor limit. Its random test code is never recorded as a valid login code or returned.

## Trusted identity and OTP

Tenant identity comes from the existing validated hostname resolver and its database mapping. Phones accept local Iranian forms (including Persian digits) and normalize to `+989121234567`; Kavenegar receives `09121234567`. The migration canonicalizes valid existing mobile records without granting verification unless `mobileVerifiedAt` was already present. Ambiguous duplicates fail migration for review rather than resetting or merging accounts. Database constraints enforce canonical phone and lowercase username uniqueness per tenant.

The official [Better Auth Phone Number plugin](https://better-auth.com/docs/plugins/phone-number) generates and server-manages six-digit OTPs, five-minute expiry, three failed guesses, atomic consumption, phone updates and session creation. The adapter only delivers the generated code. A failed delivery removes the pending verification through the library adapter. Persistent limits add a 60-second phone resend cooldown, per-phone verification limits and source limits. Tenant-bound advisory locks serialize send/verify operations and the existing participant signup limit. Audit entries contain actions and request IDs, never OTPs, phones or profile answers. Production responses never contain OTPs or auth session tokens from phone/username sign-in.

The official [Username plugin](https://better-auth.com/docs/plugins/username) validates 3–30 ASCII characters (a letter followed by letters, digits or underscores), lowercases identifiers, rejects reserved internal names, and handles password authentication. Availability checks are throttled. Username assignment is immutable after first assignment. Phone-created accounts retain `emailVerified=false`; the username-only auth instance therefore requires a verified phone or verified real email at session creation instead of requiring verification of the internal address. Email/password authentication still requires verified email. Password hashing, length rules, lockout, RBAC and secure session behavior remain in place.

Phone-created users receive an opaque tenant-bound HMAC address under `phone.eventos.invalid` through the library's supported `signUpOnVerification` mechanism. It is a non-routable database identity, not verified email. Mail adapters reject delivery to it and UI DTOs hide it. It can later be replaced by a real address through a normal authenticated, email-verification flow; it must never be marked verified just to enable username login.

## Settings, profiles and recovery

SMS and username/password are enabled in the tenant method defaults. SMS is shown only when the platform capability and a configured allowed provider are available. Existing email/password access stays available during migration; legacy enabled email OTP and Google retain their settings. Administrators can explicitly disable optional methods after verifying their own replacement method. Saving settings requires at least one permitted method usable by the current administrator; `settings.manage` protects writes. Super Admin has an audited email-login recovery action, which requires platform password capability and does not bypass password, account or email verification.

Identity (phone, verification, username, credentials and sessions) stays in `tenant_users` and auth tables. Participant first/last names use structured profile columns; configured responses use bounded JSONB. Default fields require only first name, last name and mobile for phone signup; other built-ins, including national ID, start disabled. Up to 40 definitions support controlled field types, labels, helper text, order, signup/profile visibility and edit permissions. Values are validated against current definitions. Protected identity fields cannot be removed or disabled; phone changes always require OTP. Staff views filter `adminVisible`; national ID additionally requires the high-risk `participant.sensitive.read` permission (initially granted only to the organization owner). Profile data is separate from event registration answers and never overwrites them.

## Local tests and production

`SMS_TRANSPORT=test` selects the bounded in-memory test adapter only with `NODE_ENV=test` or `development`. Both configuration parsing and adapter/registry calls reject it in production, with no E2E exception. There is no test SMS HTTP route and no verification bypass.

Unit and PostgreSQL tests use the test adapter and mocked Kavenegar HTTP. Playwright tests run the production build with `SMS_TRANSPORT=provider`; the test-only process preload mocks outbound Kavenegar HTTP and captures delivery into a restricted disposable temporary file. It does not register a production route, choose the TEST adapter, or accept a code without Better Auth verification. Production app source never imports that preload. Automated tests must never contact or bill a live SMS provider.


## Implementation files

The Identity V2 change set touches the following 52 files:

- `.env.example`
- `docs/SECURITY.md`
- `docs/SMS-PROVIDERS.md`
- `docs/TESTING.md`
- `playwright.config.ts`
- `prisma/tenant/migrations/0014_identity_v2/migration.sql`
- `prisma/tenant/schema.prisma`
- `scripts/e2e-server-pid.mjs`
- `scripts/migrate-tenant-databases.ts`
- `src/app/_components/identity-account-methods.tsx`
- `src/app/_components/identity-profile-editor.tsx`
- `src/app/_components/identity-profile-fields.tsx`
- `src/app/_components/identity-settings-editor.tsx`
- `src/app/_components/identity-v2-login.tsx`
- `src/app/_components/platform-sms-settings.tsx`
- `src/app/_components/tenant-people-manager.tsx`
- `src/app/_components/tenant-settings.tsx`
- `src/app/(tenant)/settings/page.tsx`
- `src/app/account/page.tsx`
- `src/app/api/platform/tenants/[tenantId]/identity-recovery/route.ts`
- `src/app/api/platform/tenants/[tenantId]/sms-providers/route.ts`
- `src/app/api/tenant-auth/[...all]/route.ts`
- `src/app/api/tenant/identity/participants/[userId]/profile/route.ts`
- `src/app/api/tenant/identity/profile/route.ts`
- `src/app/api/tenant/identity/settings/route.ts`
- `src/app/api/tenant/identity/username/route.ts`
- `src/app/login/page.tsx`
- `src/infrastructure/auth/mailer.ts`
- `src/infrastructure/db/control/migrations/0011_sms_provider_allowlist.sql`
- `src/infrastructure/db/tenant/prisma-migrations.ts`
- `src/modules/sms/kavenegar.ts`
- `src/modules/sms/provider.ts`
- `src/modules/sms/registry.ts`
- `src/modules/sms/test-provider.ts`
- `src/modules/tenant-identity/auth.ts`
- `src/modules/tenant-identity/identity-v2-auth-route.ts`
- `src/modules/tenant-identity/identity-v2-repository.ts`
- `src/modules/tenant-identity/identity-v2-schema.ts`
- `src/modules/tenant-identity/repository.ts`
- `src/modules/tenant-identity/request-auth.ts`
- `src/shared/config/env.ts`
- `TASKS.md`
- `tests/e2e/global-setup.ts`
- `tests/e2e/global-teardown.ts`
- `tests/e2e/identity-v2-flows.ts`
- `tests/e2e/platform-admin.spec.ts`
- `tests/e2e/sms-http.mjs`
- `tests/integration/identity-v2.test.ts`
- `tests/integration/phase-one.test.ts`
- `tests/integration/program-core.test.ts`
- `tests/unit/config.test.ts`
- `tests/unit/identity-v2.test.ts`
