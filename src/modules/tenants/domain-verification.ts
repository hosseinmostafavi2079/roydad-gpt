import "server-only";

import { Resolver } from "node:dns/promises";
import { createHash, randomBytes } from "node:crypto";
import { DomainError } from "@/shared/errors/domain-error";

export type TxtResolver = (hostname: string) => Promise<string[][]>;
export const dnsVerificationTimeoutMs = 5000;

export function newDomainChallenge(hostname: string) {
  const token = randomBytes(32).toString("base64url");
  return {
    hash: createHash("sha256").update(token).digest("hex"),
    verification: {
      recordName: `_eventos-verification.${hostname}`,
      recordType: "TXT" as const,
      recordValue: `eventos-verification=${token}`,
    },
  };
}

export function matchesDomainChallenge(
  records: string[][],
  hash: string,
): boolean {
  return records.some((chunks) => {
    const record = chunks.join("");
    return (
      /^eventos-verification=[A-Za-z0-9_-]{43}$/.test(record) &&
      createHash("sha256")
        .update(record.slice("eventos-verification=".length))
        .digest("hex") === hash
    );
  });
}

export async function lookupDomainTxt(
  hostname: string,
  resolve?: TxtResolver,
): Promise<string[][]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resolver = resolve
    ? undefined
    : new Resolver({ timeout: dnsVerificationTimeoutMs, tries: 1 });
  const lookup: TxtResolver =
    resolve ??
    ((name) => {
      if (!resolver) throw new Error("DNS resolver unavailable");
      return resolver.resolveTxt(name);
    });
  try {
    return await Promise.race([
      lookup(`_eventos-verification.${hostname}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("DNS deadline")),
          dnsVerificationTimeoutMs,
        );
      }),
    ]);
  } catch {
    throw new DomainError(
      "DOMAIN_UNVERIFIED",
      "DNS verification is unavailable or the required TXT record was not found.",
    );
  } finally {
    clearTimeout(timer);
    resolver?.cancel();
  }
}
