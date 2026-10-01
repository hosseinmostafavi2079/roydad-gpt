import { z } from "zod";
import { isE2eTestServer } from "@/shared/config/env";
import type { PaymentProvider } from "./provider";
import { testPaymentProvider } from "./test-provider";

const installed = new Map<string, PaymentProvider<unknown>>([
  [testPaymentProvider.key, testPaymentProvider],
]);

function validateProvider(provider: PaymentProvider<unknown>): void {
  const { capabilities } = provider;
  if (
    capabilities.supportsWebhook !==
      Boolean(provider.verifyWebhook && provider.identifyWebhook) ||
    capabilities.supportsServerVerification !==
      Boolean(provider.verifyPayment) ||
    capabilities.supportsRefund !== Boolean(provider.refund) ||
    capabilities.supportsPaymentStatusQuery !==
      Boolean(provider.queryPayment) ||
    capabilities.supportsSettlementQuery !==
      Boolean(provider.querySettlement) ||
    (capabilities.supportsPartialRefund && !capabilities.supportsRefund)
  )
    throw new Error("Payment provider capabilities do not match its methods.");
}

function testProviderAvailable(): boolean {
  return process.env.NODE_ENV !== "production" || isE2eTestServer();
}

export function resolvePaymentProvider(key: string): PaymentProvider<unknown> {
  const provider = installed.get(key);
  if (!provider) throw new Error("Payment provider is unavailable.");
  validateProvider(provider);
  if (key === "TEST" && !testProviderAvailable())
    throw new Error("TEST payment provider is unavailable in production.");
  return provider;
}

export function listPaymentProviders(): ReadonlyArray<{
  key: string;
  displayName: string;
  capabilities: PaymentProvider<unknown>["capabilities"];
}> {
  return [...installed.values()]
    .filter((provider) => provider.key !== "TEST" || testProviderAvailable())
    .map(({ key, displayName, capabilities }) => ({
      key,
      displayName,
      capabilities,
    }));
}

export function parseProviderConfiguration(
  key: string,
  input: unknown,
): unknown {
  return resolvePaymentProvider(key).configSchema.parse(input);
}

export function registerPaymentProviderForTests<Config>(
  provider: PaymentProvider<Config>,
): () => void {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Test provider registration is unavailable.");
  if (
    !/^[A-Z][A-Z0-9_]{1,39}$/.test(provider.key) ||
    installed.has(provider.key)
  )
    throw new Error("Invalid or duplicate payment provider key.");
  validateProvider(provider as PaymentProvider<unknown>);
  installed.set(provider.key, provider as PaymentProvider<unknown>);
  return () => {
    installed.delete(provider.key);
  };
}

export const providerKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
