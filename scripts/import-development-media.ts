import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { LocalMediaStorage } from "../src/infrastructure/media/local";
import { DomainError } from "../src/shared/errors/domain-error";

const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export async function importDevelopmentObject(
  destination: LocalMediaStorage,
  key: string,
  bytes: Uint8Array,
  apply: boolean,
) {
  let existing: Uint8Array | undefined;
  try {
    existing = await destination.get(key);
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
      throw error;
  }
  if (existing) {
    if (
      existing.length !== bytes.length ||
      checksum(existing) !== checksum(bytes)
    )
      throw new Error(
        "Development media destination conflict; nothing overwritten.",
      );
    return "matched";
  }
  if (!apply) return "pending";
  await destination.put(key, "application/octet-stream", bytes);
  const saved = await destination.get(key);
  if (saved.length !== bytes.length || checksum(saved) !== checksum(bytes))
    throw new Error("Development media verification failed.");
  return "copied";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (
      process.argv.slice(2).some((arg) => arg !== "--apply") ||
      process.env.PLATFORM_BASE_DOMAIN !== "localhost" ||
      process.env.MEDIA_STORAGE_DRIVER !== "local" ||
      process.env.MEDIA_LOCAL_ROOT !== "/app/data/media"
    )
      throw new Error("Isolated Docker development storage only.");
    const destination = new LocalMediaStorage("/app/data/media");
    const counts = { matched: 0, pending: 0, copied: 0 };
    for await (const line of createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    })) {
      if (line.length > 72 * 1024 * 1024) throw new Error("Oversized object.");
      const value: unknown = JSON.parse(line);
      if (
        typeof value !== "object" ||
        !value ||
        !("key" in value) ||
        !("body" in value) ||
        !("sha256" in value) ||
        typeof value.key !== "string" ||
        typeof value.body !== "string" ||
        typeof value.sha256 !== "string"
      )
        throw new Error("Invalid transfer.");
      const bytes = Buffer.from(value.body, "base64");
      if (checksum(bytes) !== value.sha256)
        throw new Error("Invalid transfer checksum.");
      counts[
        await importDevelopmentObject(
          destination,
          value.key,
          bytes,
          process.argv.includes("--apply"),
        )
      ]++;
    }
    console.log(JSON.stringify(counts));
  } catch {
    console.error(
      "Development media import failed; source retained, conflicting objects never overwritten.",
    );
    process.exitCode = 1;
  }
}
