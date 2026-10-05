import { z } from "zod";

export type SmsCapabilities = Readonly<{
  supportsOtpTemplate: boolean;
  supportsPlainSms: boolean;
  supportsDeliveryStatus: boolean;
  supportsSenderLine: boolean;
}>;
export interface SmsProvider {
  readonly key: string;
  readonly capabilities: SmsCapabilities;
  readonly configSchema: z.ZodType;
  readonly configurationFields?: readonly {
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
  }[];
  validateConfig(input: unknown): unknown;
  sendOtp(input: {
    config: unknown;
    phone: string;
    code: string;
    tenantId: string;
    requestId: string;
  }): Promise<void>;
}
export class SmsDeliveryError extends Error {
  constructor(
    readonly code: "CONFIGURATION" | "UNAVAILABLE" | "REJECTED" | "TIMEOUT",
  ) {
    super("ارسال کد با مشکل مواجه شد. لطفاً کمی بعد دوباره تلاش کنید.");
    this.name = "SmsDeliveryError";
  }
}
