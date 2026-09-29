import "server-only";

import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { getServerConfig } from "@/shared/config/env";

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

export async function sendTenantInvitationEmail(input: {
  email: string;
  tenantName: string;
  inviteUrl: string;
}): Promise<void> {
  const config = getServerConfig();
  // The PID marker is injected only by the E2E harness for its tracked server.
  const isTrackedPlaywrightServer =
    config.NODE_ENV === "production" &&
    process.env.EVENTOS_E2E_SERVER_PID_FILE === "tests/.e2e-server.json";
  if (config.NODE_ENV === "test" || isTrackedPlaywrightServer) {
    const outboxPath = process.env.EVENTOS_TEST_MAIL_OUTBOX;
    const tempRoot = path.resolve(os.tmpdir());
    const resolved = outboxPath ? path.resolve(outboxPath) : "";
    if (!resolved?.startsWith(`${tempRoot}${path.sep}`)) {
      throw new Error("The test invitation outbox is unavailable.");
    }
    const file = await open(resolved, "a", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(`${JSON.stringify(input)}\n`, "utf8");
    } finally {
      await file.close();
    }
    return;
  }
  if (!config.SMTP_URL) {
    throw new Error("Tenant invitation email delivery is not configured.");
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  const inviteUrl = escapeHtml(input.inviteUrl);
  try {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: input.email,
      subject: `Activate your ${input.tenantName} EventOS account`,
      text: `You have been invited to ${input.tenantName}. Activate your account using this one-time link within 24 hours: ${input.inviteUrl}`,
      html: `<p>You have been invited to ${escapeHtml(input.tenantName)}.</p><p><a href="${inviteUrl}">Activate your account</a></p><p>This one-time link expires after 24 hours. If you did not expect this invitation, ignore this message.</p>`,
    });
  } finally {
    transport.close();
  }
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
