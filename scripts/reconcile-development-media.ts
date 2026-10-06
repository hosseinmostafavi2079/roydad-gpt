import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Pool } from "pg";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { LocalMediaStorage } from "../src/infrastructure/media/local";
import { DomainError } from "../src/shared/errors/domain-error";

export interface DevelopmentMediaRecord {
  id: string;
  object_key: string;
  content_type: string;
  size_bytes: string | number;
}
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export async function reconcileDevelopmentMedia(
  records: DevelopmentMediaRecord[],
  source: (key: string) => Promise<Uint8Array | null>,
  destination: LocalMediaStorage,
  apply = false,
) {
  const summary = {
    mode: apply ? "apply" : "dry-run",
    copied: 0,
    recoverable: 0,
    matched: 0,
    orphaned: [] as string[],
    conflicts: [] as string[],
  };
  for (const record of records) {
    let existing: Uint8Array | null;
    try {
      existing = await destination.get(record.object_key);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
        throw error;
      existing = null;
    }
    const bytes = await source(record.object_key);
    if (!bytes) {
      if (!existing) summary.orphaned.push(record.id);
      else if (existing.length !== Number(record.size_bytes))
        summary.conflicts.push(record.id);
      else summary.matched++;
      continue;
    }
    if (
      bytes.length !== Number(record.size_bytes) ||
      (existing &&
        (existing.length !== bytes.length ||
          digest(existing) !== digest(bytes)))
    ) {
      summary.conflicts.push(record.id);
      continue;
    }
    if (existing) {
      summary.matched++;
      continue;
    }
    summary.recoverable++;
    if (apply) {
      await destination.put(record.object_key, record.content_type, bytes);
      const saved = await destination.get(record.object_key);
      if (saved.length !== bytes.length || digest(saved) !== digest(bytes))
        throw new Error("Development media copy verification failed.");
      summary.copied++;
    }
  }
  return summary;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let control: Pool | undefined;
  let s3: S3Client | undefined;
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--apply"))
      throw new Error("Only --apply is accepted.");
    process.loadEnvFile(".env");
    const env = process.env;
    if (
      env.NODE_ENV === "production" ||
      env.CI ||
      env.PLATFORM_BASE_DOMAIN !== "localhost"
    )
      throw new Error("Development only.");
    for (const key of ["CONTROL_DATABASE_URL", "TENANT_RUNTIME_DATABASE_URL"]) {
      if (
        !["127.0.0.1", "localhost"].includes(new URL(env[key] ?? "").hostname)
      )
        throw new Error("Local databases only.");
    }
    const endpoint = new URL(env.MEDIA_S3_ENDPOINT ?? "");
    if (
      endpoint.origin !== "http://127.0.0.1:59000" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/"
    )
      throw new Error("Local S3Mock source only.");
    if (
      !env.MEDIA_S3_BUCKET ||
      !env.MEDIA_S3_ACCESS_KEY_ID ||
      !env.MEDIA_S3_SECRET_ACCESS_KEY
    )
      throw new Error("Source configuration required.");
    s3 = new S3Client({
      endpoint: endpoint.href,
      region: env.MEDIA_S3_REGION || "us-east-1",
      forcePathStyle: true,
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
      },
    });
    const client = s3;
    control = new Pool({ connectionString: env.CONTROL_DATABASE_URL });
    const tenants = await control.query(
      "SELECT tenant_id,database_name FROM tenant_database_registry",
    );
    for (const tenant of tenants.rows) {
      if (!/^eventos_t_[a-f0-9]{32}$/.test(tenant.database_name))
        throw new Error("Invalid tenant database name.");
      const url = new URL(env.TENANT_RUNTIME_DATABASE_URL ?? "");
      url.pathname = `/${tenant.database_name}`;
      const pool = new Pool({ connectionString: url.href });
      try {
        const records = await pool.query<DevelopmentMediaRecord>(
          "SELECT id,object_key,content_type,size_bytes FROM tenant_media WHERE tenant_id=$1",
          [tenant.tenant_id],
        );
        for (const record of records.rows)
          if (!record.object_key.startsWith(`tenants/${tenant.tenant_id}/`))
            throw new Error("Tenant media namespace mismatch.");
        const summary = await reconcileDevelopmentMedia(
          records.rows,
          async (key) => {
            try {
              const response = await client.send(
                new GetObjectCommand({
                  Bucket: env.MEDIA_S3_BUCKET,
                  Key: key,
                  ChecksumMode: "ENABLED",
                }),
              );
              if (!response.Body) throw new Error("Missing source body.");
              return await response.Body.transformToByteArray();
            } catch (error) {
              if (error instanceof Error && error.name === "NoSuchKey")
                return null;
              throw error;
            }
          },
          new LocalMediaStorage(path.resolve(".local/eventos-media")),
          process.argv.includes("--apply"),
        );
        console.log(JSON.stringify({ tenant: tenant.tenant_id, ...summary }));
        if (summary.conflicts.length) process.exitCode = 1;
      } finally {
        await pool.end();
      }
    }
  } catch {
    console.error(
      "Development reconciliation failed. Sources and metadata are unchanged; inspect configuration privately.",
    );
    process.exitCode = 1;
  } finally {
    await control?.end();
    s3?.destroy();
  }
}
