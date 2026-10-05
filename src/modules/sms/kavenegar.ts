import "server-only";
import { z } from "zod";
import { normalizeIranianPhone } from "@/modules/tenant-identity/identity-v2-schema";
import { SmsDeliveryError, type SmsProvider } from "./provider";

export const kavenegarConfigSchema = z.strictObject({
  apiKey: z.string().regex(/^[a-zA-Z0-9]{16,256}$/),
  otpTemplate: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  sender: z
    .string()
    .regex(/^\d{3,20}$/)
    .optional(),
});
export function createKavenegarProvider(
  fetcher: typeof fetch = fetch,
): SmsProvider {
  return {
    key: "KAVENEGAR",
    configurationFields: [
      { key: "apiKey", label: "API Key", secret: true, required: true },
      { key: "otpTemplate", label: "Template", secret: false, required: true },
      {
        key: "sender",
        label: "خط ارسال (اختیاری)",
        secret: false,
        required: false,
      },
    ],
    capabilities: {
      supportsOtpTemplate: true,
      supportsPlainSms: false,
      supportsDeliveryStatus: false,
      supportsSenderLine: false,
    },
    configSchema: kavenegarConfigSchema,
    validateConfig: (input) => kavenegarConfigSchema.parse(input),
    async sendOtp({ config, phone, code }) {
      const parsed = kavenegarConfigSchema.safeParse(config);
      if (!parsed.success || !/^\d{6}$/.test(code))
        throw new SmsDeliveryError("CONFIGURATION");
      const receptor = normalizeIranianPhone(phone).replace(/^\+98/, "0");
      try {
        const response = await fetcher(
          `https://api.kavenegar.com/v1/${parsed.data.apiKey}/verify/lookup.json`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              receptor,
              token: code,
              template: parsed.data.otpTemplate,
              type: "sms",
            }),
            signal: AbortSignal.timeout(8000),
            redirect: "error",
          },
        );
        if (!response.ok)
          throw new SmsDeliveryError(
            response.status === 429 || response.status >= 500
              ? "UNAVAILABLE"
              : "REJECTED",
          );
        const body = z
          .object({ return: z.object({ status: z.number() }) })
          .safeParse(await response.json());
        if (!body.success || body.data.return.status !== 200)
          throw new SmsDeliveryError("REJECTED");
      } catch (error) {
        if (error instanceof SmsDeliveryError) throw error;
        throw new SmsDeliveryError(
          error instanceof Error &&
            ["TimeoutError", "AbortError"].includes(error.name)
            ? "TIMEOUT"
            : "UNAVAILABLE",
        );
      }
    },
  };
}
