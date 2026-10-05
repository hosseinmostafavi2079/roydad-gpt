// Production-mode browser tests exercise the SMTP adapter without network email.
// Loaded only by the explicit E2E preload; never imported by application routes.
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
if (
  process.env.EVENTOS_E2E_SERVER_PID_FILE !== "tests/.e2e-server.json" ||
  globalThis[Symbol.for("eventos.e2e.mail.outbox")] !== true
)
  throw new Error("E2E mail capture unavailable");
const outbox = path.resolve(process.env.EVENTOS_TEST_MAIL_OUTBOX || "");
if (!outbox.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`))
  throw new Error("Invalid E2E mail outbox");
export function captureTransport() {
  return {
    async sendMail(message) {
      const inviteUrl = message.text?.match(
        /https?:\/\/[^\s]+\/accept-invitation\?token=[A-Za-z0-9_-]+/,
      )?.[0];
      appendFileSync(
        outbox,
        `${JSON.stringify({ email: message.to, subject: message.subject, text: message.text, html: message.html, ...(inviteUrl ? { inviteUrl } : {}) })}\n`,
        { mode: 0o600 },
      );
      return { accepted: [message.to], rejected: [] };
    },
    close() {},
  };
}
// Next standalone and the source runner can resolve separate package copies.
// Nodemailer has separate ESM/CJS exports; intercept both explicitly.
nodemailer.createTransport = captureTransport;
for (const entry of [
  path.join(process.cwd(), "package.json"),
  path.join(process.cwd(), ".next/standalone/server.js"),
]) {
  createRequire(entry)("nodemailer").createTransport = captureTransport;
}
