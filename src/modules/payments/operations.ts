import type {
  PaymentIdentity,
  PaymentProvider,
  ProviderPaymentResult,
  ProviderVerificationResult,
} from "./provider";
import { assertRefundCapability, assertVerifiedPayment } from "./provider";

export async function createProviderAttempt<Config>(
  provider: PaymentProvider<Config>,
  input: PaymentIdentity & Readonly<{ callbackUrl: string; config: Config }>,
): Promise<ProviderPaymentResult> {
  if (
    !provider.capabilities.supportsServerVerification &&
    !provider.capabilities.supportsWebhook
  )
    throw new Error("Provider has no trusted verification channel.");
  const result = await provider.createPayment(input);
  if (result.state === "SUCCEEDED" || result.state === "REFUNDED")
    throw new Error("Provider creation cannot confirm a payment.");
  if (
    result.state === "REQUIRES_REDIRECT" &&
    (!provider.capabilities.supportsRedirectPayment || !result.redirectUrl)
  )
    throw new Error("Provider redirect response is invalid.");
  return result;
}

export async function verifyProviderAttempt<Config>(
  provider: PaymentProvider<Config>,
  input: PaymentIdentity &
    Readonly<{
      config: Config;
      providerAuthority: string | null;
      callback: Readonly<Record<string, string>>;
    }>,
): Promise<ProviderVerificationResult> {
  if (
    !provider.capabilities.supportsServerVerification ||
    !provider.verifyPayment
  )
    throw new Error("Provider cannot verify payments server-side.");
  const result = await provider.verifyPayment(input);
  assertVerifiedPayment(input, result);
  return result;
}

export async function queryProviderAttempt<Config>(
  provider: PaymentProvider<Config>,
  input: PaymentIdentity &
    Readonly<{
      config: Config;
      providerAuthority: string | null;
    }>,
): Promise<ProviderVerificationResult> {
  if (
    !provider.capabilities.supportsPaymentStatusQuery ||
    !provider.queryPayment
  )
    throw new Error("Provider status query is unavailable.");
  const result = await provider.queryPayment(input);
  assertVerifiedPayment(input, result);
  return result;
}

export async function requestProviderRefund<Config>(
  provider: PaymentProvider<Config>,
  input: PaymentIdentity &
    Readonly<{
      config: Config;
      refundId: string;
      refundAmount: bigint;
      providerTransactionId: string | null;
      reason: string;
    }>,
) {
  assertRefundCapability(provider, input.amount, input.refundAmount);
  if (!provider.refund) throw new Error("Provider API refund is unavailable.");
  return provider.refund(input);
}
