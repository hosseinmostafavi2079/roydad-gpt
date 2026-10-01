import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentProvider, PaymentState } from "./provider";

export const testProviderConfigSchema = z.strictObject({});

function testKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("TEST payment provider needs a server secret.");
  return Buffer.from(secret);
}

function signature(attemptId: string, outcome: string, scenario = ""): string {
  return createHmac("sha256", testKey())
    .update(`${attemptId}:${outcome}${scenario ? `:${scenario}` : ""}`)
    .digest("hex");
}

export const testPaymentProvider: PaymentProvider<
  z.infer<typeof testProviderConfigSchema>
> = {
  key: "TEST",
  displayName: "EventOS TEST",
  configSchema: testProviderConfigSchema,
  capabilities: {
    supportsRedirectPayment: true,
    supportsWebhook: false,
    supportsServerVerification: true,
    supportsRefund: true,
    supportsPartialRefund: true,
    supportsPaymentStatusQuery: true,
    supportsSettlementQuery: false,
    supportsSandbox: false,
  },
  async createPayment(input) {
    const redirect = new URL(input.callbackUrl);
    const scenario = redirect.searchParams.get("testScenario") ?? "";
    const outcome =
      scenario === "FAILED"
        ? "FAILED"
        : scenario === "PENDING"
          ? "PENDING"
          : "SUCCEEDED";
    redirect.searchParams.set("attempt", input.paymentAttemptId);
    redirect.searchParams.set("outcome", outcome);
    redirect.searchParams.set(
      "proof",
      scenario === "INVALID_SIGNATURE"
        ? "0".repeat(64)
        : signature(input.paymentAttemptId, outcome, scenario),
    );
    return {
      state: "REQUIRES_REDIRECT",
      providerAuthority: input.paymentAttemptId,
      redirectUrl: redirect.toString(),
    };
  },
  async verifyPayment(input) {
    const outcome = input.callback.outcome;
    const proof = input.callback.proof;
    const scenario = input.callback.testScenario ?? "";
    const allowed: PaymentState[] = [
      "SUCCEEDED",
      "FAILED",
      "EXPIRED",
      "PENDING",
    ];
    if (
      input.providerAuthority !== input.paymentAttemptId ||
      !outcome ||
      !allowed.includes(outcome as PaymentState) ||
      !proof ||
      !/^[a-f0-9]{64}$/.test(proof) ||
      !timingSafeEqual(
        Buffer.from(proof, "hex"),
        Buffer.from(
          signature(input.paymentAttemptId, outcome, scenario),
          "hex",
        ),
      )
    )
      throw new Error("TEST payment verification failed.");
    return {
      state: outcome as PaymentState,
      verifiedAmount:
        scenario === "AMOUNT_MISMATCH" ? input.amount + 1n : input.amount,
      verifiedCurrency: input.currency,
      ...(outcome === "SUCCEEDED"
        ? {
            providerTransactionId: `test-${input.paymentAttemptId}`,
            providerReferenceId: `test-${input.paymentAttemptId}`,
          }
        : {}),
    };
  },
  async queryPayment(input) {
    return {
      state: "PENDING",
      verifiedAmount: input.amount,
      verifiedCurrency: input.currency,
    };
  },
  async refund(input) {
    if (input.reason === "TEST_REFUND_FAILED")
      throw new Error("TEST refund failure injected.");
    return {
      state: "REFUNDED",
      reference: `test-refund-${input.refundId}`,
    };
  },
};
