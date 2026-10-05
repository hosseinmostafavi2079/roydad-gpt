import "server-only";

import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { getServerConfig, isE2eTestServer } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";

export function emailServiceAvailable(): boolean {
  const config = getServerConfig();
  return (
    config.MAIL_TRANSPORT === "test" ||
    (config.MAIL_TRANSPORT === "smtp" &&
      Boolean(config.SMTP_URL && config.SMTP_FROM))
  );
}
export function assertEmailServiceAvailable(): void {
  if (!emailServiceAvailable())
    throw new DomainError(
      "FEATURE_DISABLED",
      "سرویس ایمیل در دسترس نیست. برای دریافت راهنمایی با مدیر سامانه تماس بگیرید.",
    );
}

type InvitationEmail = Readonly<{
  email: string;
  tenantName: string;
  inviteUrl: string;
}>;
type MailMessage = Readonly<{
  email: string;
  subject: string;
  text: string;
  html: string;
}>;

interface InvitationEmailProvider {
  send(message: MailMessage): Promise<void>;
}

class TestOutboxInvitationProvider implements InvitationEmailProvider {
  async send(message: MailMessage): Promise<void> {
    if (message.email.endsWith("@phone.eventos.invalid"))
      throw new Error("Internal phone identity cannot receive email.");
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

  async send(message: MailMessage): Promise<void> {
    if (message.email.endsWith("@phone.eventos.invalid"))
      throw new Error("Internal phone identity cannot receive email.");
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
  assertEmailServiceAvailable();
  const config = getServerConfig();
  if (config.MAIL_TRANSPORT === "test" || isE2eTestServer()) {
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
  await invitationProvider().send({
    email: input.email,
    subject: "EventOS platform administrator password reset",
    text: `A password reset was requested for your EventOS platform administrator account. Use this one-time link within one hour: ${input.resetUrl}`,
    html: `<p>A password reset was requested for your EventOS platform administrator account.</p><p><a href="${escapeHtml(input.resetUrl)}">Reset your password</a></p><p>This one-time link expires after one hour. If you did not request it, ignore this message.</p>`,
  });
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

export async function sendTenantEmailOtp(input: {
  email: string;
  otp: string;
  tenantName: string;
}): Promise<void> {
  await invitationProvider().send({
    email: input.email,
    subject: `کد ورود به ${input.tenantName}`,
    text: `کد یک‌بارمصرف ورود شما: ${input.otp}. این کد تا پنج دقیقه معتبر است. اگر درخواست نکرده‌اید، این پیام را نادیده بگیرید.`,
    html: `<p>کد یک‌بارمصرف ورود به ${escapeHtml(input.tenantName)}:</p><p dir="ltr"><strong>${escapeHtml(input.otp)}</strong></p><p>این کد تا پنج دقیقه معتبر است.</p>`,
  });
}

export async function sendTenantVerificationEmail(input: {
  email: string;
  url: string;
  tenantName: string;
}): Promise<void> {
  await invitationProvider().send({
    email: input.email,
    subject: `تأیید ایمیل در ${input.tenantName}`,
    text: `برای تأیید حساب خود در ${input.tenantName} از این پیوند یک‌بارمصرف استفاده کنید: ${input.url}`,
    html: `<p>برای تأیید حساب خود در ${escapeHtml(input.tenantName)} از این پیوند استفاده کنید:</p><p><a href="${escapeHtml(input.url)}">تأیید ایمیل</a></p>`,
  });
}

export async function sendTenantPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}): Promise<void> {
  const resetUrl = escapeHtml(input.resetUrl);
  await invitationProvider().send({
    email: input.email,
    subject: "EventOS tenant account password reset",
    text: `A password reset was requested for your EventOS tenant account. Use this one-time link within one hour: ${input.resetUrl}`,
    html: `<p>A password reset was requested for your EventOS tenant account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This one-time link expires after one hour. If you did not request it, ignore this message.</p>`,
  });
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
