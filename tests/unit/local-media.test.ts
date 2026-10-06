import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  link,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import {
  LocalMediaStorage,
  validateObjectKey,
} from "@/infrastructure/media/local";
import { mediaObjectKey } from "@/modules/media/validation";
import {
  putMediaObject,
  getMediaObject,
  deleteMediaObject,
} from "@/infrastructure/media/storage";
import {
  migrateLocalMedia,
  type MigrationRemote,
} from "../../scripts/migrate-local-media-to-s3";

const config = vi.hoisted(() => ({
  MEDIA_STORAGE_DRIVER: "local",
  MEDIA_LOCAL_ROOT: "",
  MEDIA_S3_ENDPOINT: "",
  MEDIA_S3_BUCKET: "",
  MEDIA_S3_REGION: "us-east-1",
  MEDIA_S3_ACCESS_KEY_ID: "",
  MEDIA_S3_SECRET_ACCESS_KEY: "",
  MEDIA_S3_ALLOW_HTTP_LOCAL: false,
  PLATFORM_BASE_DOMAIN: "example.test",
}));
vi.mock("@/shared/config/env", () => ({ getServerConfig: () => config }));
let root: string;
let store: LocalMediaStorage;
let key: string;
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "eventos-local-media-"));
  store = new LocalMediaStorage(root);
  key = mediaObjectKey(
    randomUUID(),
    "WEBSITE_LOGO",
    randomUUID(),
    randomUUID(),
  );
  config.MEDIA_STORAGE_DRIVER = "local";
  config.MEDIA_LOCAL_ROOT = root;
  config.MEDIA_S3_ENDPOINT = "";
  config.MEDIA_S3_BUCKET = "";
  config.MEDIA_S3_ACCESS_KEY_ID = "";
  config.MEDIA_S3_SECRET_ACCESS_KEY = "";
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("local persistent media", () => {
  it("puts, atomically replaces, reads and deletes with unchanged S3 object keys and no S3 configuration", async () => {
    await putMediaObject(key, "image/png", bytes);
    expect(await getMediaObject(key)).toEqual(bytes);
    expect(await readFile(path.join(root, ...validateObjectKey(key)))).toEqual(
      Buffer.from(bytes),
    );
    const replacement = Uint8Array.from([...bytes, 4]);
    await putMediaObject(key, "image/png", replacement);
    expect(await getMediaObject(key)).toEqual(replacement);
    expect(await store.listKeys()).toEqual([key]);
    await deleteMediaObject(key);
    await deleteMediaObject(key); // deletion is idempotent and exact
    await expect(getMediaObject(key)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("keeps tenant objects distinct and accepts existing certificate keys", async () => {
    const other = key.replace(key.split("/")[1] ?? "", randomUUID());
    const certificate = `tenants/${randomUUID()}/certificates/${randomUUID()}.pdf`;
    await store.put(key, "image/png", bytes);
    await store.put(other, "image/png", Uint8Array.of(42));
    await store.put(certificate, "application/pdf", Buffer.from("%PDF-1.7"));
    await store.delete(key);
    expect(await store.get(other)).toEqual(Uint8Array.of(42));
    expect(Buffer.from(await store.get(certificate)).toString()).toBe(
      "%PDF-1.7",
    );
  });
  it("reads bounded ranges, including an open end, and rejects invalid ranges", async () => {
    await store.put(key, "image/png", bytes);
    expect(await store.get(key, "bytes=2-5")).toEqual(bytes.slice(2, 6));
    expect(await store.get(key, "bytes=8-")).toEqual(bytes.slice(8));
    expect(await store.get(key, "bytes=8-100")).toEqual(bytes.slice(8));
    for (const range of [
      "bytes=99-100",
      "bytes=5-2",
      "bytes=-5",
      "bytes=0-1,4-5",
    ])
      await expect(store.get(key, range)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
  });
  it.each([
    "../outside",
    "/etc/passwd",
    "C:\\outside",
    "tenants/../../outside",
    "tenants/%2e%2e/file",
    "tenants\\outside",
    "tenants/uuid/con.txt",
  ])("rejects unsafe key %s for every operation", async (bad) => {
    await expect(store.put(bad, "image/png", bytes)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(store.get(bad)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(store.delete(bad)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(await readdir(root)).toEqual([]);
  });
  it("rejects a symlink/junction parent without reading, writing or deleting the outside file", async () => {
    const outside = await mkdtemp(
      path.join(os.tmpdir(), "eventos-media-outside-"),
    );
    try {
      await writeFile(path.join(outside, "sentinel"), "outside");
      await symlink(
        outside,
        path.join(root, "tenants"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(store.put(key, "image/png", bytes)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(store.get(key)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(store.delete(key)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(store.listKeys()).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe(
        "outside",
      );
      expect(await readdir(outside)).toEqual(["sentinel"]);
    } finally {
      await rm(path.join(root, "tenants"), { force: true, recursive: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("rejects an outside hard link at the exact object leaf", async () => {
    const outside = await mkdtemp(
      path.join(os.tmpdir(), "eventos-media-hardlink-"),
    );
    try {
      await store.put(key, "image/png", bytes);
      const target = path.join(root, ...validateObjectKey(key));
      await rm(target);
      const sentinel = path.join(outside, "sentinel");
      await writeFile(sentinel, "outside");
      await link(sentinel, target);
      await expect(store.get(key)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(store.put(key, "image/png", bytes)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(store.delete(key)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(await readFile(sentinel, "utf8")).toBe("outside");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("rejects a linked root", async () => {
    const linked = `${root}-link`;
    try {
      await symlink(
        root,
        linked,
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(
        new LocalMediaStorage(linked).put(key, "image/png", bytes),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    } finally {
      await rm(linked, { force: true, recursive: true });
    }
  });
  it("keeps strict S3 configuration checks and delegates valid S3 requests", async () => {
    config.MEDIA_STORAGE_DRIVER = "s3";
    await expect(putMediaObject(key, "image/png", bytes)).rejects.toMatchObject(
      { code: "INVALID_STATE_TRANSITION" },
    );
    Object.assign(config, {
      MEDIA_S3_ENDPOINT: "http://storage.example.test",
      MEDIA_S3_BUCKET: "test",
      MEDIA_S3_ACCESS_KEY_ID: "synthetic",
      MEDIA_S3_SECRET_ACCESS_KEY: "synthetic",
    });
    await expect(putMediaObject(key, "image/png", bytes)).rejects.toMatchObject(
      { code: "INVALID_STATE_TRANSITION" },
    );
    config.MEDIA_S3_ENDPOINT = "https://storage.example.test";
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockImplementation(async () => ({}));
    await putMediaObject(key, "image/png", bytes);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Key: key,
      ServerSideEncryption: "AES256",
    });
  });
});

describe("local to S3 migration", () => {
  it("defaults to dry-run with no destination initialization or local writes", async () => {
    await store.put(key, "image/png", bytes);
    const remote = vi.fn(() => {
      throw new Error("must not initialize");
    });
    expect(await migrateLocalMedia(store, remote)).toMatchObject({
      mode: "dry-run",
      objects: 1,
      bytes: bytes.length,
      uploaded: 0,
    });
    expect(remote).not.toHaveBeenCalled();
    expect(await store.get(key)).toEqual(bytes);
  });
  it("uploads, verifies, resumes idempotently and refuses mismatched remote data without local deletion", async () => {
    await store.put(key, "image/png", bytes);
    const objects = new Map<string, Uint8Array>();
    const put = vi.fn(async (name: string, _mime: string, body: Uint8Array) => {
      if (objects.has(name)) throw new Error("precondition");
      objects.set(name, body);
    });
    const remote: MigrationRemote = {
      get: async (name) => objects.get(name) ?? null,
      putIfAbsent: put,
    };
    expect(await migrateLocalMedia(store, () => remote, true)).toMatchObject({
      uploaded: 1,
      matched: 0,
    });
    expect(await migrateLocalMedia(store, () => remote, true)).toMatchObject({
      uploaded: 0,
      matched: 1,
    });
    objects.set(key, Uint8Array.of(9));
    expect(await migrateLocalMedia(store, () => remote, true)).toMatchObject({
      uploaded: 0,
      conflicts: 1,
    });
    expect(put).toHaveBeenCalledOnce();
    expect(await store.get(key)).toEqual(bytes);
  });
  it("fails if the uploaded checksum/size does not match", async () => {
    await store.put(key, "image/png", bytes);
    let uploaded = false;
    const remote: MigrationRemote = {
      get: async () => (uploaded ? Uint8Array.of(9) : null),
      putIfAbsent: async () => {
        uploaded = true;
      },
    };
    await expect(migrateLocalMedia(store, () => remote, true)).rejects.toThrow(
      /verification failed/,
    );
    expect(await store.get(key)).toEqual(bytes);
  });
});
