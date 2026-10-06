import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getMediaObject } from "@/infrastructure/media/s3";

const config = vi.hoisted(() => ({
  MEDIA_S3_ENDPOINT: "",
  MEDIA_S3_BUCKET: "range-tests",
  MEDIA_S3_REGION: "us-east-1",
  MEDIA_S3_ACCESS_KEY_ID: "synthetic-test-key",
  MEDIA_S3_SECRET_ACCESS_KEY: "synthetic-test-secret",
  MEDIA_S3_ALLOW_HTTP_LOCAL: true,
  PLATFORM_BASE_DOMAIN: "localhost",
}));
vi.mock("@/shared/config/env", () => ({ getServerConfig: () => config }));
let server: Server;
let corrupt = false;
const modes: (string | undefined)[] = [];
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

beforeAll(async () => {
  server = createServer((request, response) => {
    modes.push(request.headers["x-amz-checksum-mode"] as string | undefined);
    const range = Boolean(request.headers.range);
    const body = range ? bytes.slice(0, 8) : Uint8Array.from(bytes);
    if (corrupt) body[0] = 0;
    response.writeHead(range ? 206 : 200, {
      "Content-Length": body.length,
      "x-amz-checksum-crc32": "xGtbMQ==", // Full-object CRC32, including on the mock's partial response.
      ...(range ? { "Content-Range": `bytes 0-7/${bytes.length}` } : {}),
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  config.MEDIA_S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
it("verifies full-object checksums without comparing them to partial range bytes", async () => {
  expect(await getMediaObject("test-object")).toEqual(bytes);
  expect(await getMediaObject("test-object", "bytes=0-7")).toEqual(
    bytes.slice(0, 8),
  );
  expect(modes).toEqual(["ENABLED", undefined]);
  corrupt = true;
  await expect(getMediaObject("test-object")).rejects.toThrow(
    /Checksum mismatch/,
  );
  expect(modes[2]).toBe("ENABLED");
});
