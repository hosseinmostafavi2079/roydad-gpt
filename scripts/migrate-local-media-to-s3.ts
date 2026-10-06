import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { LocalMediaStorage } from "../src/infrastructure/media/local";

export interface MigrationRemote {
  get(key: string): Promise<Uint8Array | null>;
  putIfAbsent(
    key: string,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<void>;
}
const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function contentType(bytes: Uint8Array): string {
  const prefix = Buffer.from(bytes.subarray(0, 12));
  if (
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
    return "image/jpeg";
  if (
    prefix.toString("ascii", 0, 4) === "RIFF" &&
    prefix.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (prefix.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (prefix.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  throw new Error("Unsupported local media signature; migration stopped.");
}

export async function migrateLocalMedia(
  local: LocalMediaStorage,
  remote: () => MigrationRemote,
  apply = false,
) {
  const summary = {
    mode: apply ? "apply" : "dry-run",
    objects: 0,
    bytes: 0,
    uploaded: 0,
    matched: 0,
    conflicts: 0,
  };
  const destination = apply ? remote() : undefined;
  for (const key of await local.listKeys()) {
    const bytes = await local.get(key);
    const mime = contentType(bytes);
    summary.objects++;
    summary.bytes += bytes.length;
    if (!destination) continue; // Dry-run does not initialize or contact S3, or write locally.
    const existing = await destination.get(key);
    if (existing) {
      if (
        existing.length !== bytes.length ||
        checksum(existing) !== checksum(bytes)
      ) {
        summary.conflicts++;
        continue;
      }
      summary.matched++;
      continue;
    }
    await destination.putIfAbsent(key, mime, bytes);
    const uploaded = await destination.get(key);
    if (
      !uploaded ||
      uploaded.length !== bytes.length ||
      checksum(uploaded) !== checksum(bytes)
    )
      throw new Error(
        "Remote media verification failed; keep the local driver.",
      );
    summary.uploaded++;
  }
  return summary;
}

function s3Destination(env: NodeJS.ProcessEnv): MigrationRemote {
  const endpoint = new URL(env.MEDIA_S3_ENDPOINT ?? "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    ["localhost", "127.0.0.1", "storage", "postgres"].includes(
      endpoint.hostname,
    ) ||
    env.MEDIA_S3_ALLOW_HTTP_LOCAL !== "false" ||
    !env.MEDIA_S3_REGION ||
    !env.MEDIA_S3_BUCKET ||
    !env.MEDIA_S3_ACCESS_KEY_ID ||
    !env.MEDIA_S3_SECRET_ACCESS_KEY
  )
    throw new Error(
      "Migration requires complete external HTTPS S3 configuration.",
    );
  const client = new S3Client({
    endpoint: endpoint.href,
    region: env.MEDIA_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.MEDIA_S3_BUCKET;
  return {
    async get(key) {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (!response.Body) throw new Error("Empty remote response");
        return response.Body.transformToByteArray();
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async putIfAbsent(key, mime, bytes) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: mime,
          Body: bytes,
          IfNoneMatch: "*",
          ServerSideEncryption: "AES256",
          ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
        }),
      );
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--apply"))
      throw new Error("Only --apply is accepted.");
    if (process.env.MEDIA_STORAGE_DRIVER !== "local")
      throw new Error("Migration source must be the local driver.");
    const root = process.env.MEDIA_LOCAL_ROOT;
    if (!root) throw new Error("MEDIA_LOCAL_ROOT is required.");
    const summary = await migrateLocalMedia(
      new LocalMediaStorage(root),
      () => s3Destination(process.env),
      process.argv.includes("--apply"),
    );
    console.log(JSON.stringify(summary));
    if (summary.conflicts) process.exitCode = 1;
  } catch {
    console.error(
      "Media migration failed; no local data deleted, driver unchanged. Check configuration and remote conflicts privately.",
    );
    process.exitCode = 1;
  }
}
