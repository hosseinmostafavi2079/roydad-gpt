// Imported only by the Playwright process preload, never by application source.
// Exercise the production adapter with mocked HTTP; normal Better Auth OTP
// generation, expiry, attempts, consumption and session creation still run.
import { appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const output = path.resolve(process.env.EVENTOS_E2E_SMS_HTTP_OUTBOX ?? "");
if (
  !output.startsWith(`${path.resolve(os.tmpdir())}${path.sep}eventos-e2e-sms-`)
)
  throw new Error("E2E SMS HTTP outbox must be a disposable temporary file.");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname !== "api.kavenegar.com") return originalFetch(input, init);
  if (
    url.protocol !== "https:" ||
    !/^\/v1\/[a-zA-Z0-9]{16,256}\/verify\/lookup\.json$/.test(url.pathname) ||
    init?.method !== "POST"
  )
    throw new Error("Unexpected SMS provider test request.");
  const body = new URLSearchParams(String(init.body));
  appendFileSync(
    output,
    `${JSON.stringify({ phone: body.get("receptor"), code: body.get("token") })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return Response.json({ return: { status: 200 } });
};
