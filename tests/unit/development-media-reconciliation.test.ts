import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { reconcileDevelopmentMedia } from "../../scripts/reconcile-development-media";
import { LocalMediaStorage } from "@/infrastructure/media/local";
import { importDevelopmentObject } from "../../scripts/import-development-media";

const roots: string[] = [];
const key =
  "tenants/11111111-1111-4111-8111-111111111111/programs/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333";
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const record = {
  id: "44444444-4444-4444-8444-444444444444",
  object_key: key,
  content_type: "image/png",
  size_bytes: 8,
};
async function local() {
  const root = await mkdtemp(path.join(tmpdir(), "eventos-reconcile-"));
  roots.push(root);
  return new LocalMediaStorage(root);
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("dry-run reads source but writes no local objects or metadata", async () => {
  const destination = await local();
  const before = { ...record };
  expect(
    (await reconcileDevelopmentMedia([record], async () => bytes, destination))
      .recoverable,
  ).toBe(1);
  expect(await destination.listKeys()).toEqual([]);
  expect(record).toEqual(before);
});
it("apply preserves keys, IDs and URLs, verifies bytes and safely resumes", async () => {
  const destination = await local();
  expect(
    (
      await reconcileDevelopmentMedia(
        [record],
        async () => bytes,
        destination,
        true,
      )
    ).copied,
  ).toBe(1);
  expect(await destination.get(key)).toEqual(bytes);
  expect(
    (
      await reconcileDevelopmentMedia(
        [record],
        async () => bytes,
        destination,
        true,
      )
    ).matched,
  ).toBe(1);
  expect(record.id).toBe("44444444-4444-4444-8444-444444444444");
  expect(record.object_key).toBe(key);
});
it("reports missing sources without deleting metadata and refuses size/byte conflicts", async () => {
  const destination = await local();
  expect(
    (
      await reconcileDevelopmentMedia(
        [record],
        async () => null,
        destination,
        true,
      )
    ).orphaned,
  ).toEqual([record.id]);
  expect(
    (
      await reconcileDevelopmentMedia(
        [record],
        async () => bytes.slice(0, 2),
        destination,
        true,
      )
    ).conflicts,
  ).toEqual([record.id]);
  await destination.put(key, "image/png", bytes);
  expect(
    (
      await reconcileDevelopmentMedia(
        [record],
        async () => new Uint8Array(8),
        destination,
        true,
      )
    ).conflicts,
  ).toEqual([record.id]);
  expect(await destination.get(key)).toEqual(bytes);
});
it("rejects traversal before contacting source", async () => {
  const destination = await local();
  let reads = 0;
  await expect(
    reconcileDevelopmentMedia(
      [{ ...record, object_key: "../outside" }],
      async () => {
        reads++;
        return bytes;
      },
      destination,
      true,
    ),
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
it("Docker transfer is dry-run by default, verified and refuses conflicting overwrites", async () => {
  const destination = await local();
  expect(await importDevelopmentObject(destination, key, bytes, false)).toBe(
    "pending",
  );
  expect(await destination.listKeys()).toEqual([]);
  expect(await importDevelopmentObject(destination, key, bytes, true)).toBe(
    "copied",
  );
  expect(await importDevelopmentObject(destination, key, bytes, true)).toBe(
    "matched",
  );
  await expect(
    importDevelopmentObject(destination, key, new Uint8Array(8), true),
  ).rejects.toThrow(/conflict/);
  expect(await destination.get(key)).toEqual(bytes);
});
