import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dnsVerificationTimeoutMs,
  lookupDomainTxt,
  matchesDomainChallenge,
  newDomainChallenge,
} from "@/modules/tenants/domain-verification";

afterEach(() => vi.useRealTimers());
describe("DNS ownership challenge", () => {
  it("generates independent random challenges, hashes at rest and matches split TXT chunks", () => {
    const a = newDomainChallenge("event.customer.ir");
    const b = newDomainChallenge("event.customer.ir");
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.verification.recordName).toBe(
      "_eventos-verification.event.customer.ir",
    );
    expect(a.verification.recordValue).toMatch(
      /^eventos-verification=[A-Za-z0-9_-]{43}$/,
    );
    expect(
      matchesDomainChallenge(
        [
          [
            a.verification.recordValue.slice(0, 30),
            a.verification.recordValue.slice(30),
          ],
        ],
        a.hash,
      ),
    ).toBe(true);
    expect(matchesDomainChallenge([[b.verification.recordValue]], a.hash)).toBe(
      false,
    );
    expect(
      matchesDomainChallenge([[`${a.verification.recordValue}suffix`]], a.hash),
    ).toBe(false);
    expect(
      matchesDomainChallenge(
        [[a.verification.recordValue.replace("eventos-verification=", "")]],
        a.hash,
      ),
    ).toBe(false);
  });
  it("queries only the ownership TXT name with an injected resolver", async () => {
    const resolve = vi.fn().mockResolvedValue([["txt"]]);
    expect(await lookupDomainTxt("event.customer.ir", resolve)).toEqual([
      ["txt"],
    ]);
    expect(resolve).toHaveBeenCalledWith(
      "_eventos-verification.event.customer.ir",
    );
  });
  it("returns a safe DNS failure without the resolver error or token", async () => {
    await expect(
      lookupDomainTxt("event.customer.ir", async () => {
        throw new Error("secret-provider-error");
      }),
    ).rejects.toThrow("DNS verification is unavailable");
  });
  it("bounds a stalled injected resolver and clears its timer", async () => {
    vi.useFakeTimers();
    const result = expect(
      lookupDomainTxt("event.customer.ir", () => new Promise(() => {})),
    ).rejects.toMatchObject({ code: "DOMAIN_UNVERIFIED" });
    await vi.advanceTimersByTimeAsync(dnsVerificationTimeoutMs);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
