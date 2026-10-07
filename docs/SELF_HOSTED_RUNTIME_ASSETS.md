# Self-hosted runtime assets

EventOS core frontend assets are bundled with the application. Vazirmatn weights
400–700 import CSS from `@fontsource/vazirmatn`; Next emits the referenced font
files into local `/_next/static/media`. No Google Fonts loader or frontend CDN
is required. React, Next, Tailwind and icons are bundled npm/code assets.

`scripts/prepare-standalone.mjs` copies Next static assets into the standalone
package, which the Docker image includes. The audit found no required remote
core logo, background, script or stylesheet. Tenant-configurable media remains
tenant content; it is not a required EventOS UI asset.

Run `node scripts/check-external-runtime-assets.mjs`. The existing CI quality
workflow runs this deterministic source gate. Its explicit roots are `src/app`
(excluding API handlers), optional `src/components`, and optional `public`.
It rejects known CDN/font hosts, remote asset extensions, remote CSS imports/URLs
and literal remote script/style/image references. Comments, API/provider modules,
tests and documentation are excluded. Dynamic/computed URLs require code review;
the complementary browser gate checks requests actually made by pages.

Run `pnpm exec playwright test --config playwright.runtime-assets.config.ts`
against a local built standalone server on port 3001 and the existing local demo
database. It checks sign-in, Backup Center, Diagnostics Center and the public demo
tenant while blocking third-party browser requests, and verifies local fonts.
This focused test does not invoke OAuth or payment actions and reads existing
private demo credentials without printing them.

For this local acceptance server only, build with `pnpm build`, then start
`node --env-file=.env .next/standalone/server.js` in a separate terminal with
`NODE_ENV=production`, `MAIL_TRANSPORT=disabled`, `SMS_TRANSPORT=provider`,
`PORT=3001`, `HOSTNAME=127.0.0.1`, and
`BETTER_AUTH_URL=http://localhost:3001`. Stop that server after the test.
Do not change production environment files to run this local check.

External runtime UI asset dependencies differ from external product/service
integrations. SMTP, Kavenegar/SMS, payments, Google OAuth, S3 and DNS providers
remain functional and are intentionally outside this asset rule. Existing HTTP
security behavior is unchanged; the audit adds no CSP allowances or relaxations.
