import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Explicit frontend roots; API/provider modules, tests and documentation are excluded.
const roots = ["src/app", "src/components", "public"];
const extensions = /\.(?:[cm]?[jt]sx?|css|html|svg)$/i;
const deniedHosts =
  /(?:fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|(?:cdn\.)?jsdelivr\.net|cdnjs\.cloudflare\.com|bootstrapcdn\.com)(?:[/:]|$)/i;
const remote = /(?:https?:)?\/\/[^\s"'<>`)]+/gi;
const assetExtension =
  /\.(?:css|[cm]?js|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico)(?:[?#]|$)/i;

export function inspectRuntimeSource(filename, source) {
  const findings = [];
  function inspect(value, context = "literal") {
    if (value.includes("next/font/google"))
      findings.push("remote Google font loader");
    for (const url of value.match(remote) ?? []) {
      if (
        deniedHosts.test(url) ||
        assetExtension.test(url) ||
        context === "asset"
      )
        findings.push(`external browser asset (${context})`);
    }
  }
  if (/\.[cm]?[jt]sx?$/i.test(filename)) {
    const tree = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (ts.isStringLiteralLike(node)) inspect(node.text);
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(tree);
        const tag = node.parent.parent.tagName?.getText(tree)?.toLowerCase();
        if (
          (name === "src" &&
            [
              "script",
              "img",
              "image",
              "iframe",
              "video",
              "source",
              "audio",
            ].includes(tag)) ||
          (name === "href" && ["link", "image", "use"].includes(tag))
        ) {
          if (node.initializer)
            inspect(node.initializer.getText(tree), "asset");
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  } else {
    const text = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    inspect(text);
    for (const match of text.matchAll(
      /(?:@import\s+(?:url\()?|url\()\s*["']?((?:https?:)?\/\/[^\s"')]+)/gi,
    ))
      inspect(match[1], "asset");
    for (const match of text.matchAll(
      /<(?:script|link|img|image|use)\b[^>]*\b(?:src|href|xlink:href)\s*=\s*["']([^"']+)/gi,
    ))
      inspect(match[1], "asset");
  }
  return [...new Set(findings)];
}

export function scanRuntimeAssets(root = process.cwd()) {
  const failures = [];
  function walk(relative) {
    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(relative, entry.name);
      if (filename.replaceAll("\\", "/") === "src/app/api") continue;
      if (entry.isDirectory()) walk(filename);
      else if (extensions.test(filename)) {
        for (const reason of inspectRuntimeSource(
          filename,
          readFileSync(path.join(root, filename), "utf8"),
        ))
          failures.push({ filename, reason });
      }
    }
  }
  for (const relative of roots)
    if (existsSync(path.join(root, relative))) walk(relative);
  return failures;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = scanRuntimeAssets();
  for (const { filename, reason } of failures)
    console.error(`${filename}: ${reason}`);
  if (failures.length) process.exitCode = 1;
  else console.log("Self-hosted runtime asset check passed.");
}
