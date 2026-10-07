import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { LocalMediaStorage } from "@/infrastructure/media/local";
import { tenantArchiveKeys } from "@/modules/platform/backups/media-archive";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
it("tenant archive selection contains only selected tenant including certificates; empty tenant safe", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eventos-backup-media-"));
  try {
    const storage = new LocalMediaStorage(root);
    const key = `tenants/${a}/website/object`,
      cert = `tenants/${a}/certificates/document.pdf`;
    for (const value of [key, cert, `tenants/${b}/website/object`])
      await storage.put(value, "image/png", new Uint8Array([1, 2]));
    expect(await tenantArchiveKeys(storage, a)).toEqual([cert, key]);
    const archive = execFileSync(
      "tar",
      ["-czf", "-", "-C", root, "--null", "--no-recursion", "--files-from=-"],
      { input: `${(await tenantArchiveKeys(storage, a)).join("\0")}\0` },
    );
    const entries = execFileSync("tar", ["-tzf", "-"], {
      input: archive,
      encoding: "utf8",
    });
    expect(entries.trim().split(/\r?\n/)).toEqual([cert, key]);
    expect(entries).not.toContain(b);
    const empty = execFileSync(
      "tar",
      ["-czf", "-", "-C", root, "--null", "--no-recursion", "--files-from=-"],
      { input: "" },
    );
    expect(
      execFileSync("tar", ["-tzf", "-"], { input: empty, encoding: "utf8" }),
    ).toBe("");
    expect(
      await tenantArchiveKeys(storage, "33333333-3333-4333-8333-333333333333"),
    ).toEqual([]);
    await expect(tenantArchiveKeys(storage, "../escape")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("tenant media selection rejects symlink/junction escape", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eventos-backup-link-")),
    outside = await mkdtemp(path.join(tmpdir(), "eventos-backup-outside-"));
  try {
    await mkdir(path.join(root, "tenants"));
    await symlink(
      outside,
      path.join(root, "tenants", a),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      tenantArchiveKeys(new LocalMediaStorage(root), a),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
