import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createProviderAttempt,
  queryProviderAttempt,
  requestProviderRefund,
  verifyProviderAttempt,
} from "../../src/modules/payments/operations";
import type { PaymentProvider } from "../../src/modules/payments/provider";
import {
  registerPaymentProviderForTests,
  resolvePaymentProvider,
} from "../../src/modules/payments/registry";

const identity = {
  paymentId: "payment-1",
  paymentAttemptId: "attempt-1",
  amount: 2500n,
  currency: "IRR",
};

const fakeSchema = z.strictObject({ merchantId: z.string().min(1) });
const secondAdapter: PaymentProvider<z.infer<typeof fakeSchema>> = {
  key: "SECOND_FAKE",
  displayName: "Second fake adapter",
  configSchema: fakeSchema,
  capabilities: {
    supportsRedirectPayment: false,
    supportsWebhook: true,
    supportsServerVerification: true,
    supportsRefund: false,
    supportsPartialRefund: false,
    supportsPaymentStatusQuery: true,
    supportsSettlementQuery: false,
    supportsSandbox: true,
  },
  async createPayment() {
    return { state: "PENDING", providerAuthority: "bank-authority" };
  },
  async verifyPayment() {
    const gatewayStatus: string = "CAPTURED";
    return {
      state:
        gatewayStatus === "CAPTURED"
          ? ("SUCCEEDED" as const)
          : ("PENDING" as const),
      verifiedAmount: 2500n,
      verifiedCurrency: "IRR",
      providerTransactionId: "bank-transaction",
    };
  },
  async queryPayment() {
    const gatewayStatus: string = "TIMED_OUT";
    return {
      state:
        gatewayStatus === "TIMED_OUT"
          ? ("EXPIRED" as const)
          : ("PENDING" as const),
      verifiedAmount: 2500n,
      verifiedCurrency: "IRR",
    };
  },
  identifyWebhook({ body }) {
    const event = JSON.parse(new TextDecoder().decode(body)) as {
      authority: string;
    };
    return { providerAuthority: event.authority };
  },
  async verifyWebhook({ headers, body }) {
    if (headers.get("x-fake-signature") !== "valid") return null;
    const event = JSON.parse(new TextDecoder().decode(body)) as {
      authority: string;
      eventId: string;
    };
    return {
      providerAuthority: event.authority,
      eventId: event.eventId,
      result: {
        state: "SUCCEEDED",
        verifiedAmount: 2500n,
        verifiedCurrency: "IRR",
      },
    };
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider-neutral payment operations", () => {
  it("creates, verifies, maps status, and enforces capabilities through a second adapter", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const unregister = registerPaymentProviderForTests(secondAdapter);
    try {
      const provider = resolvePaymentProvider("SECOND_FAKE");
      const config = provider.configSchema.parse({ merchantId: "merchant" });
      const created = await createProviderAttempt(provider, {
        ...identity,
        config,
        callbackUrl: "https://example.invalid/return",
      });
      expect(created).toEqual({
        state: "PENDING",
        providerAuthority: "bank-authority",
      });
      const verified = await verifyProviderAttempt(provider, {
        ...identity,
        config,
        providerAuthority: created.providerAuthority ?? null,
        callback: {},
      });
      expect(verified.state).toBe("SUCCEEDED");
      expect(verified.providerTransactionId).toBe("bank-transaction");
      const queried = await queryProviderAttempt(provider, {
        ...identity,
        config,
        providerAuthority: created.providerAuthority ?? null,
      });
      expect(queried.state).toBe("EXPIRED");
      const webhook = new TextEncoder().encode(
        JSON.stringify({ authority: "bank-authority", eventId: "event-1" }),
      );
      expect(
        provider.identifyWebhook?.({ headers: new Headers(), body: webhook })
          .providerAuthority,
      ).toBe("bank-authority");
      expect(
        await provider.verifyWebhook?.({
          config,
          headers: new Headers({ "x-fake-signature": "valid" }),
          body: webhook,
        }),
      ).toMatchObject({ eventId: "event-1", result: { state: "SUCCEEDED" } });
      await expect(
        requestProviderRefund(provider, {
          ...identity,
          config,
          refundId: "refund-1",
          refundAmount: 2500n,
          providerTransactionId: "bank-transaction",
          reason: "Participant request",
        }),
      ).rejects.toThrow("Provider API refund is unavailable");
    } finally {
      unregister();
    }
  });

  it("rejects a mismatched verified amount and production TEST adapter selection", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const provider = {
      ...secondAdapter,
      verifyPayment: async () => ({
        state: "SUCCEEDED" as const,
        verifiedAmount: 1n,
        verifiedCurrency: "IRR",
      }),
    };
    await expect(
      verifyProviderAttempt(provider, {
        ...identity,
        config: { merchantId: "merchant" },
        providerAuthority: "bank-authority",
        callback: {},
      }),
    ).rejects.toThrow("amount or currency mismatch");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolvePaymentProvider("TEST")).toThrow(
      "unavailable in production",
    );
  });

  it("keeps TEST verification server-authenticated and refund ids stable", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "local-unit-secret-at-least-thirty-two-characters",
    );
    const provider = resolvePaymentProvider("TEST");
    const created = await createProviderAttempt(provider, {
      ...identity,
      config: {},
      callbackUrl:
        "https://tenant.example.invalid/api/tenant/payments/callback/TEST",
    });
    expect(created.state).toBe("REQUIRES_REDIRECT");
    if (!created.redirectUrl) throw new Error("TEST redirect was not created.");
    const redirect = new URL(created.redirectUrl);
    const callback = Object.fromEntries(redirect.searchParams);
    await expect(
      verifyProviderAttempt(provider, {
        ...identity,
        config: {},
        providerAuthority: created.providerAuthority ?? null,
        callback: { ...callback, proof: "0".repeat(64) },
      }),
    ).rejects.toThrow("verification failed");
    const verified = await verifyProviderAttempt(provider, {
      ...identity,
      config: {},
      providerAuthority: created.providerAuthority ?? null,
      callback,
    });
    expect(verified.state).toBe("SUCCEEDED");
    const refund = await requestProviderRefund(provider, {
      ...identity,
      config: {},
      refundId: "refund-1",
      refundAmount: 2500n,
      providerTransactionId: verified.providerTransactionId ?? null,
      reason: "Participant request",
    });
    expect(refund.reference).toBe("test-refund-refund-1");
  });

  it("keeps local TEST outcomes signed and rejects mismatched amounts and refund failures", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "local-unit-secret-at-least-thirty-two-characters",
    );
    const provider = resolvePaymentProvider("TEST");
    for (const [scenario, state] of [
      ["FAILED", "FAILED"],
      ["PENDING", "PENDING"],
    ] as const) {
      const created = await createProviderAttempt(provider, {
        ...identity,
        config: {},
        callbackUrl: `https://example.invalid/callback?testScenario=${scenario}`,
      });
      const callback = Object.fromEntries(
        new URL(created.redirectUrl ?? "").searchParams,
      );
      const result = await verifyProviderAttempt(provider, {
        ...identity,
        config: {},
        providerAuthority: created.providerAuthority ?? null,
        callback,
      });
      expect(result.state).toBe(state);
    }
    for (const scenario of ["INVALID_SIGNATURE", "AMOUNT_MISMATCH"]) {
      const created = await createProviderAttempt(provider, {
        ...identity,
        config: {},
        callbackUrl: `https://example.invalid/callback?testScenario=${scenario}`,
      });
      const callback = Object.fromEntries(
        new URL(created.redirectUrl ?? "").searchParams,
      );
      await expect(
        verifyProviderAttempt(provider, {
          ...identity,
          config: {},
          providerAuthority: created.providerAuthority ?? null,
          callback,
        }),
      ).rejects.toThrow();
    }
    await expect(
      requestProviderRefund(provider, {
        ...identity,
        config: {},
        refundId: "refund-failed",
        refundAmount: 2500n,
        providerTransactionId: "test-transaction",
        reason: "TEST_REFUND_FAILED",
      }),
    ).rejects.toThrow("failure injected");
  });
});
