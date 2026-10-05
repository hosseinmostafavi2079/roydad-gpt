import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

if (process.env.NODE_ENV !== "production") {
  throw new Error("The E2E server PID hook requires production mode.");
}

const configuredPath = process.env.EVENTOS_E2E_SERVER_PID_FILE;
if (!configuredPath) {
  throw new Error("The E2E server PID file path is not configured.");
}

const serverStatePath = path.resolve(process.cwd(), configuredPath);
const testsDirectory = path.resolve(process.cwd(), "tests");
const relativePath = path.relative(testsDirectory, serverStatePath);
if (
  relativePath === "" ||
  relativePath.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativePath)
) {
  throw new Error("The E2E server PID file must stay inside the tests folder.");
}
if (existsSync(serverStatePath)) {
  throw new Error(
    "An E2E server PID file already exists; stop its recorded process before retrying.",
  );
}

writeFileSync(
  serverStatePath,
  JSON.stringify({ pid: process.pid, cwd: process.cwd() }),
  { flag: "wx", mode: 0o600 },
);
globalThis[Symbol.for("eventos.e2e.mail.outbox")] = true;
await import("../tests/e2e/mail-transport.mjs");
if (process.env.EVENTOS_E2E_SMS_HTTP_OUTBOX)
  await import("../tests/e2e/sms-http.mjs");
if (process.env.EVENTOS_E2E_DOMAIN_DNS_FILE)
  await import("../tests/e2e/domain-dns.mjs");
