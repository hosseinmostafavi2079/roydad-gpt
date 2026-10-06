import {
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  developmentMediaRoot,
  localMediaEnvironment,
  prepareDevelopmentMediaRoot,
} from "../../scripts/local-media-env.mjs";

describe("persistent development media configuration", () => {
  it("uses an absolute private workspace root and preserves files on repeated setup", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "eventos-local-config-"));
    try {
      const root = prepareDevelopmentMediaRoot(workspace);
      expect(path.isAbsolute(root)).toBe(true);
      expect(root).toBe(developmentMediaRoot(workspace));
      writeFileSync(path.join(root, "preserved"), "unchanged");
      prepareDevelopmentMediaRoot(workspace);
      expect(readFileSync(path.join(root, "preserved"), "utf8")).toBe(
        "unchanged",
      );
      expect(localMediaEnvironment(workspace)).toEqual({
        MEDIA_STORAGE_DRIVER: "local",
        MEDIA_LOCAL_ROOT: root.replaceAll("\\", "/"),
      });
      expect(
        localMediaEnvironment(workspace, "local", true).MEDIA_LOCAL_ROOT,
      ).toBe("/app/data/media");
      expect(localMediaEnvironment(workspace, "s3").MEDIA_STORAGE_DRIVER).toBe(
        "s3",
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
  it("rejects a linked development data directory", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "eventos-local-link-"));
    const outside = mkdtempSync(path.join(tmpdir(), "eventos-local-outside-"));
    try {
      symlinkSync(
        outside,
        path.join(workspace, ".local"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(() => prepareDevelopmentMediaRoot(workspace)).toThrow(
        /not a link/,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("mounts only the app's distinct named media volume and keeps S3 explicit", () => {
    const compose = readFileSync("compose.yaml", "utf8");
    expect(compose).toContain("name: roydad_eventos-local-media");
    expect(compose).not.toContain("eventos-production_media");
    expect(compose.match(/local-media:\/app\/data\/media/g)).toHaveLength(1);
    expect(compose).toContain('profiles: ["s3"]');
    expect(readFileSync(".gitignore", "utf8")).toContain("/.local/");
    expect(readFileSync(".dockerignore", "utf8")).toContain(".local");
  });
  it("setup preserves existing credentials and avoids destructive data commands", () => {
    const setup = readFileSync("scripts/local-setup.mjs", "utf8");
    expect(setup).toContain("if (existsSync(envPath)) return;");
    expect(setup).not.toMatch(/down.*--volumes|volume prune|demo-reset/);
    const demo = readFileSync("scripts/demo-setup.ts", "utf8");
    expect(demo).not.toContain("Password: ${credentials");
    expect(demo).not.toContain("DELETE FROM platform_auth_sessions");
    expect(demo).not.toContain("DELETE FROM tenant_auth_sessions");
    expect(demo).toContain('ON CONFLICT ("providerId","accountId") DO NOTHING');
    expect(
      readFileSync("scripts/migrate-tenant-databases.ts", "utf8"),
    ).toContain('tenant.migration_version !== "0014_identity_v2"');
  });
});
