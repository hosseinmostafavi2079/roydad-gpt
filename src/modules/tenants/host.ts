import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import { DomainError } from "@/shared/errors/domain-error";

export function normalizeHostHeader(value: string): string {
  if (
    value.length > 300 ||
    /[\s/@?#\\]/.test(value) ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new DomainError("VALIDATION_FAILED", "The request host is invalid.");
  }

  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new DomainError("VALIDATION_FAILED", "The request host is invalid.");
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new DomainError("VALIDATION_FAILED", "The request host is invalid.");
  }

  const hostname = domainToASCII(
    parsed.hostname.toLowerCase().replace(/\.$/, ""),
  );
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname.startsWith("[") ||
    isIP(hostname)
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "IP addresses and invalid hostnames are not tenant domains.",
    );
  }

  const labels = hostname.split(".");
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new DomainError("VALIDATION_FAILED", "The request host is invalid.");
  }

  return hostname;
}

export function normalizeCustomDomain(value: string): string {
  if (value.includes(":")) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Custom domains must not include a port.",
    );
  }
  const hostname = normalizeHostHeader(value);
  if (hostname === "localhost" || !hostname.includes(".")) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Enter a fully qualified custom domain.",
    );
  }
  return hostname;
}
