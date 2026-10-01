import type { z } from "zod";

export const paymentStates = [
  "CREATED",
  "PENDING",
  "REQUIRES_REDIRECT",
  "VERIFYING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;
export type PaymentState = (typeof paymentStates)[number];

export type ProviderCapabilities = Readonly<{
  supportsRedirectPayment: boolean;
  supportsWebhook: boolean;
  supportsServerVerification: boolean;
  supportsRefund: boolean;
  supportsPartialRefund: boolean;
  supportsPaymentStatusQuery: boolean;
  supportsSettlementQuery: boolean;
  supportsSandbox: boolean;
}>;

export type PaymentIdentity = Readonly<{
  paymentId: string;
  paymentAttemptId: string;
  amount: bigint;
  currency: string;
}>;

export type ProviderPaymentResult = Readonly<{
  state: PaymentState;
  providerAuthority?: string;
  providerTransactionId?: string;
  providerReferenceId?: string;
  redirectUrl?: string;
}>;

export type ProviderVerificationResult = ProviderPaymentResult &
  Readonly<{
    verifiedAmount: bigint;
    verifiedCurrency: string;
  }>;

export interface PaymentProvider<Config> {
  readonly key: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly configSchema: z.ZodType<Config>;
  createPayment(
    input: PaymentIdentity & Readonly<{ callbackUrl: string; config: Config }>,
  ): Promise<ProviderPaymentResult>;
  verifyPayment?(
    input: PaymentIdentity &
      Readonly<{
        config: Config;
        providerAuthority: string | null;
        callback: Readonly<Record<string, string>>;
      }>,
  ): Promise<ProviderVerificationResult>;
  identifyCallback?(
    callback: Readonly<Record<string, string>>,
  ): Readonly<{ paymentAttemptId?: string; providerAuthority?: string }>;
  parseCallback?(
    input: Readonly<{
      headers: Headers;
      body: Uint8Array;
      query: Readonly<Record<string, string>>;
    }>,
  ): Readonly<Record<string, string>>;
  identifyWebhook?(
    input: Readonly<{ headers: Headers; body: Uint8Array }>,
  ): Readonly<{ providerAuthority: string }>;
  verifyWebhook?(
    input: Readonly<{ config: Config; headers: Headers; body: Uint8Array }>,
  ): Promise<Readonly<{
    providerAuthority: string;
    eventId: string;
    result: ProviderVerificationResult;
  }> | null>;
  queryPayment?(
    input: PaymentIdentity &
      Readonly<{
        config: Config;
        providerAuthority: string | null;
      }>,
  ): Promise<ProviderVerificationResult>;
  querySettlement?(
    input: PaymentIdentity &
      Readonly<{
        config: Config;
        providerTransactionId: string | null;
      }>,
  ): Promise<
    Readonly<{
      state: "PENDING" | "SUCCEEDED" | "FAILED";
      settledAmount: bigint;
      settledCurrency: string;
      providerReferenceId?: string;
    }>
  >;
  refund?(
    input: PaymentIdentity &
      Readonly<{
        config: Config;
        refundId: string;
        refundAmount: bigint;
        providerTransactionId: string | null;
        reason: string;
      }>,
  ): Promise<
    Readonly<{ state: "REFUND_PENDING" | "REFUNDED"; reference: string }>
  >;
}

export function assertVerifiedPayment(
  expected: PaymentIdentity,
  result: ProviderVerificationResult,
): void {
  if (
    result.state === "SUCCEEDED" &&
    (result.verifiedAmount !== expected.amount ||
      result.verifiedCurrency !== expected.currency)
  ) {
    throw new Error("Provider payment amount or currency mismatch.");
  }
}

export function assertRefundCapability<Config>(
  provider: PaymentProvider<Config>,
  paid: bigint,
  amount: bigint,
): void {
  if (amount <= 0n || amount > paid) throw new Error("Invalid refund amount.");
  if (!provider.capabilities.supportsRefund || !provider.refund)
    throw new Error("Provider API refund is unavailable.");
  if (amount < paid && !provider.capabilities.supportsPartialRefund)
    throw new Error("Provider partial refund is unavailable.");
}
