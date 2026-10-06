import "server-only";

import {
  DeleteObjectCommand,
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getServerConfig } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";

let client: S3Client | undefined;
function storage() {
  const config = getServerConfig();
  if (
    !config.MEDIA_S3_ENDPOINT ||
    !config.MEDIA_S3_REGION ||
    !config.MEDIA_S3_BUCKET ||
    !config.MEDIA_S3_ACCESS_KEY_ID ||
    !config.MEDIA_S3_SECRET_ACCESS_KEY
  )
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      "فضای نگهداری رسانه پیکربندی نشده است.",
    );
  const endpoint = new URL(config.MEDIA_S3_ENDPOINT);
  if (
    endpoint.protocol !== "https:" &&
    !(
      config.MEDIA_S3_ALLOW_HTTP_LOCAL &&
      config.PLATFORM_BASE_DOMAIN === "localhost" &&
      ["localhost", "127.0.0.1", "storage"].includes(endpoint.hostname)
    )
  )
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      "اتصال امن فضای رسانه پیکربندی نشده است.",
    );
  client ??= new S3Client({
    endpoint: endpoint.toString(),
    region: config.MEDIA_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: config.MEDIA_S3_SECRET_ACCESS_KEY,
    },
  });
  return { client, bucket: config.MEDIA_S3_BUCKET };
}

export async function putMediaObject(
  key: string,
  type: string,
  body: Uint8Array,
): Promise<void> {
  const { client, bucket } = storage();
  if (getServerConfig().MEDIA_S3_ALLOW_HTTP_LOCAL) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: type,
      Body: body,
      ...(getServerConfig().MEDIA_S3_ALLOW_HTTP_LOCAL
        ? {}
        : { ServerSideEncryption: "AES256" }),
    }),
  );
}
export async function getMediaObject(
  key: string,
  range?: string,
): Promise<Uint8Array> {
  const { client, bucket } = storage();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
  );
  if (!response.Body) throw new DomainError("NOT_FOUND", "رسانه یافت نشد.");
  return response.Body.transformToByteArray();
}
export async function deleteMediaObject(key: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
