import "server-only";
import { z } from "zod";
import type { SmsProvider } from "./provider";

type TestSms = {
  tenantId: string;
  phone: string;
  code: string;
  requestId: string;
};
const messages: TestSms[] = [];
export function assertTestSmsAllowed(): void {
  if (
    !["test", "development"].includes(process.env.NODE_ENV ?? "") ||
    process.env.SMS_TRANSPORT !== "test"
  )
    throw new Error("Test SMS transport is unavailable.");
}
export const testSmsProvider: SmsProvider = {
  key: "TEST",
  configSchema: z.strictObject({}),
  capabilities: {
    supportsOtpTemplate: true,
    supportsPlainSms: false,
    supportsDeliveryStatus: false,
    supportsSenderLine: false,
  },
  validateConfig(input) {
    assertTestSmsAllowed();
    return this.configSchema.parse(input);
  },
  async sendOtp({ tenantId, phone, code, requestId }) {
    assertTestSmsAllowed();
    messages.push({ tenantId, phone, code, requestId });
    while (messages.length > 100) messages.shift();
  },
};
export function readTestSms(
  tenantId: string,
  phone: string,
): TestSms | undefined {
  assertTestSmsAllowed();
  return messages.findLast(
    (message) => message.tenantId === tenantId && message.phone === phone,
  );
}
export function clearTestSms(): void {
  assertTestSmsAllowed();
  messages.length = 0;
}
