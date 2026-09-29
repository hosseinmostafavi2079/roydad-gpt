import "server-only";

import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { getServerConfig } from "@/shared/config/env";

type InvitationEmail = Readonly<{
  email: string;
  tenantName: string;
  inviteUrl: string;
}>;
type InvitationMessage = InvitationEmail &
  Readonly<{ subject: string; text: string; html: string }>;

interface InvitationEmailProvider {
  send(message: InvitationMessage): Promise<void>;
}

class TestOutboxInvitationProvider implements InvitationEmailProvider {
  async send(message: InvitationMessage): Promise<void> {
    const outboxPath = process.env.EVENTOS_TEST_MAIL_OUTBOX;
    const tempRoot = path.resolve(os.tmpdir());
    const resolved = outboxPath ? path.resolve(outboxPath) : "";
    if (!resolved.startsWith(`${tempRoot}${path.sep}`)) {
      throw new Error("The test invitation outbox is unavailable.");
    }
    const file = await open(resolved, "a", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(`${JSON.stringify(message)}\n`, "utf8");
    } finally {
      await file.close();
    }
  }
}

class SmtpInvitationProvider implements InvitationEmailProvider {
  constructor(
    private readonly smtpUrl: string,
    private readonly from: string,
  ) {}

  async send(message: InvitationMessage): Promise<void> {
    const transport = nodemailer.createTransport(this.smtpUrl);
    try {
      await transport.sendMail({
        from: this.from,
        to: message.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } finally {
      transport.close();
    }
  }
}

function invitationProvider(): InvitationEmailProvider {
  const config = getServerConfig();
  if (config.MAIL_TRANSPORT === "test") {
    return new TestOutboxInvitationProvider();
  }
  if (!config.SMTP_URL) {
    throw new Error("Tenant invitation email delivery is not configured.");
  }
  return new SmtpInvitationProvider(config.SMTP_URL, config.SMTP_FROM);
}

export async function sendPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}): Promise<void> {
  const config = getServerConfig();
  if (!config.SMTP_URL) {
    throw new Error("Password recovery email is not configured.");
  }

  const transport = nodemailer.createTransport(config.SMTP_URL);
  try {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: input.email,
      subject: "EventOS platform administrator password reset",
      text: `A password reset was requested for your EventOS platform administrator account. Use this one-time link within one hour: ${input.resetUrl}`,
      html: `<p>A password reset was requested for your EventOS platform administrator account.</p><p><a href="${escapeHtml(input.resetUrl)}">Reset your password</a></p><p>This one-time link expires after one hour. If you did not request it, ignore this message.</p>`,
    });
  } finally {
    transport.close();
  }
}

export async function sendTenantInvitationEmail(
  input: InvitationEmail,
): Promise<void> {
  await invitationProvider().send({
    ...input,
    subject: `Activate your ${input.tenantName} EventOS account`,
    text: `You have been invited to ${input.tenantName}. Activate your account using this one-time link within 24 hours: ${input.inviteUrl}`,
    html: `<p>You have been invited to ${escapeHtml(input.tenantName)}.</p><p><a href="${escapeHtml(input.inviteUrl)}">Activate your account</a></p><p>This one-time link expires after 24 hours. If you did not expect this invitation, ignore this message.</p>`,
  });
}

export async function sendTenantPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}): Promise<void> {
  const config = getServerConfig();
  if (!config.SMTP_URL) {
    throw new Error("Tenant password recovery email is not configured.");
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  const resetUrl = escapeHtml(input.resetUrl);
  try {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: input.email,
      subject: "EventOS tenant account password reset",
      text: `A password reset was requested for your EventOS tenant account. Use this one-time link within one hour: ${input.resetUrl}`,
      html: `<p>A password reset was requested for your EventOS tenant account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This one-time link expires after one hour. If you did not request it, ignore this message.</p>`,
    });
  } finally {
    transport.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}
