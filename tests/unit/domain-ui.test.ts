import { describe, expect, it } from "vitest";
import { domainInputValid } from "@/app/_components/tenant-domains";

describe("domain UI input", () => {
  it.each(["event.customer.ir", "Event.Customer.com", "bücher.example"])(
    "accepts hostname %s",
    (value) => expect(domainInputValid(value)).toBe(true),
  );
  it.each([
    "https://event.customer.ir",
    "event.customer.ir/path",
    "event.customer.ir:443",
    "user@example.ir",
    "example.ir?query",
    "127.0.0.1",
    "bad..example",
    "example.ir#fragment",
  ])("rejects URL or malformed input %s", (value) =>
    expect(domainInputValid(value)).toBe(false),
  );
});
