import "server-only";
import { getServerConfig } from "@/shared/config/env";
import { LocalMediaStorage } from "./local";
import * as s3 from "./s3";

export interface MediaStorage {
  put(key: string, contentType: string, bytes: Uint8Array): Promise<void>;
  get(key: string, range?: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

function storage(): MediaStorage {
  const config = getServerConfig();
  return config.MEDIA_STORAGE_DRIVER === "local"
    ? new LocalMediaStorage(config.MEDIA_LOCAL_ROOT)
    : {
        put: s3.putMediaObject,
        get: s3.getMediaObject,
        delete: s3.deleteMediaObject,
      };
}
export const putMediaObject = (
  key: string,
  contentType: string,
  bytes: Uint8Array,
) => storage().put(key, contentType, bytes);
export const getMediaObject = (key: string, range?: string) =>
  storage().get(key, range);
export const deleteMediaObject = (key: string) => storage().delete(key);
