import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Repository CLI is JavaScript, exercised directly without a declaration file.
import * as scanner from "../../scripts/check-external-runtime-assets.mjs";

const { inspectRuntimeSource, scanRuntimeAssets } = scanner;

it("current frontend source is self-hosted", () =>
  expect(scanRuntimeAssets()).toEqual([]));
it.each([
  ["font.tsx", 'import { Vazirmatn } from "next/font/google";'],
  [
    "style.css",
    '@import "https://fonts.googleapis.com/css2?family=Vazirmatn";',
  ],
  ["style.css", '@import url("https://example.org/styles");'],
  ["page.tsx", '<link rel="stylesheet" href="https://example.org/theme" />'],
  ["page.tsx", '<script src="https://example.org/bundle" />'],
  ["page.tsx", 'const loader = "https://unpkg.com/package";'],
  ["page.tsx", 'const loader = "https://cdn.jsdelivr.net/package";'],
  ["page.tsx", 'const loader = "https://cdnjs.cloudflare.com/package";'],
  ["style.css", "@font-face {src:url(//fonts.gstatic.com/font.woff2)}"],
  ["page.tsx", '<img src="https://example.org/logo" />'],
  ["icon.svg", '<svg><use href="https://example.org/icons#user" /></svg>'],
])("rejects external assets in %s: %s", (file, source) =>
  expect(inspectRuntimeSource(file, source).length).toBeGreaterThan(0),
);
it.each([
  ["layout.tsx", 'import "@fontsource/vazirmatn/400.css";'],
  ["page.tsx", '<img src="/api/media/local-id" />'],
  ["style.css", '@import "tailwindcss"; a{background:url(/logo.svg)}'],
  [
    "page.tsx",
    'const schema = "https://schema.org"; <a href="https://accounts.google.com/">OAuth</a>',
  ],
  ["page.tsx", "// https://unpkg.com/example.js\nconst local = true;"],
])("accepts bundled/local or harmless references in %s", (file, source) =>
  expect(inspectRuntimeSource(file, source)).toEqual([]),
);
it("excludes backend integration modules, tests and documentation", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "eventos-assets-"));
  try {
    for (const dir of ["src/app/api", "src/infrastructure", "tests", "docs"]) {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(
        path.join(root, dir, "example.ts"),
        'const provider = "https://unpkg.com/backend-example.js";',
      );
    }
    expect(scanRuntimeAssets(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
