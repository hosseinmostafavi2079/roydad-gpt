import { describe, expect, it } from "vitest";
import {
  normalizeCustomDomain,
  normalizeHostHeader,
} from "@/modules/tenants/host";
import { DomainError } from "@/shared/errors/domain-error";

describe("tenant host normalization", () => {
  it("lowercases DNS names, removes one trailing dot, ports, and IDNA encodes Unicode", () => {
    expect(normalizeHostHeader("ACME.Example.COM.:443")).toBe(
      "acme.example.com",
    );
    expect(normalizeHostHeader("xn--bcher-kva.example")).toBe(
      "xn--bcher-kva.example",
    );
    expect(normalizeHostHeader("bücher.example")).toBe("xn--bcher-kva.example");
  });

  it.each([
    "127.0.0.1",
    "[::1]",
    "bad host.example",
    "name/example.com",
    "name..example.com",
    "example.com/path",
    "example.com?x=1",
    "example.com:99999",
  ])("rejects malformed or non-DNS tenant host %s", (host) => {
    expect(() => normalizeHostHeader(host)).toThrow(DomainError);
  });

  it("requires a fully qualified custom domain without a port", () => {
    expect(normalizeCustomDomain("Portal.Example.com")).toBe(
      "portal.example.com",
    );
    expect(() => normalizeCustomDomain("portal.example.com:443")).toThrow(
      DomainError,
    );
    expect(() => normalizeCustomDomain("localhost")).toThrow(DomainError);
  });
});
