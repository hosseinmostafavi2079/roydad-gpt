import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("production-mode E2E captures the SMTP adapter without test transport or a network", () => {
  const outbox = path.join(
    os.tmpdir(),
    `eventos-e2e-mail-unit-${randomUUID()}.jsonl`,
  );
  const token = "a".repeat(43);
  const code = `globalThis[Symbol.for('eventos.e2e.mail.outbox')]=true;
    await import('./tests/e2e/mail-transport.mjs');
    const {default:nodemailer}=await import('nodemailer');
    const transport=nodemailer.createTransport('smtps://e2e:e2e@localhost:465');
    await transport.sendMail({to:'recipient@example.test',subject:'Invitation',text:'https://tenant.localhost/accept-invitation?token=${token}',html:'Invitation'});
    transport.close();`;
  try {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          MAIL_TRANSPORT: "smtp",
          EVENTOS_E2E_SERVER_PID_FILE: "tests/.e2e-server.json",
          EVENTOS_TEST_MAIL_OUTBOX: outbox,
        },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const message = JSON.parse(readFileSync(outbox, "utf8"));
    expect(message).toMatchObject({
      email: "recipient@example.test",
      subject: "Invitation",
      inviteUrl: `https://tenant.localhost/accept-invitation?token=${token}`,
    });
  } finally {
    try {
      unlinkSync(outbox);
    } catch {}
  }
});
