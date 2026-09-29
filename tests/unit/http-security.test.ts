import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertSameOrigin, parseJson } from "@/shared/http/api-response";
import { resetServerConfigForTests } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";

const config = {
  NODE_ENV: "test",
  CONTROL_DATABASE_URL:
    "postgresql://control_app:local@127.0.0.1:55432/eventos_control",
  CONTROL_MIGRATION_DATABASE_URL:
    "postgresql://control_migrator:local@127.0.0.1:55432/eventos_control",
  CONTROL_QUEUE_DATABASE_URL:
    "postgresql://control_queue:local@127.0.0.1:55432/eventos_control",
  TENANT_PROVISIONING_DATABASE_URL:
    "postgresql://tenant_provisioner:local@127.0.0.1:55432/postgres",
  TENANT_RUNTIME_DATABASE_URL:
    "postgresql://tenant_runtime:local@127.0.0.1:55432/postgres",
  TENANT_MIGRATION_DATABASE_URL:
    "postgresql://tenant_migrator:local@127.0.0.1:55432/postgres",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "unit-test-secret".repeat(4),
  PLATFORM_BASE_DOMAIN: "localhost",
};

describe("mutating request security", () => {
  it("requires an Origin header and rejects untrusted origins without trusting Host", () => {
    resetServerConfigForTests();
    const mutableEnvironment = process.env as Record<
      string,
      string | undefined
    >;
    mutableEnvironment.NODE_ENV = config.NODE_ENV;
    for (const [key, value] of Object.entries(config))
      mutableEnvironment[key] = value;
    expect(() =>
      assertSameOrigin(new Request("http://localhost:3000/api/change")),
    ).toThrow(DomainError);
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/change", {
          headers: { origin: "https://evil.example", host: "localhost:3000" },
        }),
      ),
    ).toThrow(/Cross-origin/);
    expect(() =>
      assertSameOrigin(
        new Request("http://evil.example/api/change", {
          headers: { origin: "http://evil.example", host: "evil.example" },
        }),
      ),
    ).toThrow(/Cross-origin/);
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/change", {
          headers: { origin: "http://localhost:3000/path" },
        }),
      ),
    ).toThrow(/Cross-origin/);
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/change", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
  });

  it("bounds streamed JSON bodies and rejects invalid JSON and content types", async () => {
    const schema = z.strictObject({ name: z.string() });
    const small = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "safe" }),
    });
    await expect(parseJson(small, schema)).resolves.toEqual({ name: "safe" });
    const wrongType = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    await expect(parseJson(wrongType, schema)).rejects.toThrow(/Content-Type/);
    const invalid = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    await expect(parseJson(invalid, schema)).rejects.toThrow(/valid JSON/);
    const body = "x".repeat(70_000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const oversized = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(parseJson(oversized, schema)).rejects.toThrow(DomainError);
  });
});
