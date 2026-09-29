import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const standaloneDirectory = path.join(repositoryRoot, ".next", "standalone");
const staticAssets = path.join(repositoryRoot, ".next", "static");

if (!existsSync(path.join(standaloneDirectory, "server.js"))) {
  throw new Error("Next.js standalone server output was not generated.");
}
if (!existsSync(staticAssets)) {
  throw new Error("Next.js static assets were not generated.");
}

const standaloneNextDirectory = path.join(standaloneDirectory, ".next");
mkdirSync(standaloneNextDirectory, { recursive: true });
cpSync(staticAssets, path.join(standaloneNextDirectory, "static"), {
  recursive: true,
  force: true,
});

const serverOutputDirectory = path.join(repositoryRoot, ".next", "server");
const instrumentationBundle = path.join(
  serverOutputDirectory,
  "instrumentation.js",
);
const instrumentationTrace = `${instrumentationBundle}.nft.json`;
if (existsSync(instrumentationBundle) && existsSync(instrumentationTrace)) {
  const standaloneServerDirectory = path.join(
    standaloneNextDirectory,
    "server",
  );
  const standaloneChunksDirectory = path.join(
    standaloneServerDirectory,
    "chunks",
  );
  mkdirSync(standaloneServerDirectory, { recursive: true });
  cpSync(
    instrumentationBundle,
    path.join(standaloneServerDirectory, "instrumentation.js"),
  );

  const trace = JSON.parse(readFileSync(instrumentationTrace, "utf8"));
  for (const file of trace.files) {
    const sourcePath = path.resolve(serverOutputDirectory, file);
    const relativePath = path.relative(serverOutputDirectory, sourcePath);
    if (relativePath.split(path.sep)[0] !== "chunks") continue;
    cpSync(
      sourcePath,
      path.join(standaloneChunksDirectory, path.basename(sourcePath)),
    );
  }
}

const publicAssets = path.join(repositoryRoot, "public");
if (existsSync(publicAssets)) {
  cpSync(publicAssets, path.join(standaloneDirectory, "public"), {
    recursive: true,
    force: true,
  });
}
