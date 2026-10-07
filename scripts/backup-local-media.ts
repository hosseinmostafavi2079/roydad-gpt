import { spawn } from "node:child_process";
import { LocalMediaStorage } from "../src/infrastructure/media/local";
import { z } from "zod";
import { tenantArchiveKeys } from "../src/modules/platform/backups/media-archive";

// Invoked only inside the EventOS app container after the exact named mount is checked.
try {
  if (
    process.env.MEDIA_STORAGE_DRIVER !== "local" ||
    process.env.MEDIA_LOCAL_ROOT !== "/app/data/media"
  )
    throw new Error("Unexpected media source");
  const args = process.argv.slice(2);
  const tenantId = args.length
    ? z
        .uuid()
        .parse(
          args[0] === "--tenant-id" && args.length === 2 ? args[1] : undefined,
        )
        .toLowerCase()
    : null;
  const storage = new LocalMediaStorage("/app/data/media");
  const selected = tenantId ? await tenantArchiveKeys(storage, tenantId) : null;
  if (!tenantId) await storage.listKeys(); // preserve full-media validation
  const child = spawn(
    "tar",
    [
      "--one-file-system",
      "--format=pax",
      "--exclude=.media-write-*",
      "-czf",
      "-",
      "-C",
      "/app/data/media",
      ...(selected ? ["--null", "--no-recursion", "--files-from=-"] : ["."]),
    ],
    { stdio: [selected ? "pipe" : "ignore", "inherit", "pipe"] },
  );
  if (selected) {
    child.stdin?.on("error", () => {});
    child.stdin?.end(selected.length ? `${selected.join("\0")}\0` : "");
  }
  child.stderr?.resume(); // tar may print private paths; report only safe failure status
  child.on("error", () => {
    console.error("EventOS media archive failed.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error("EventOS media archive failed.");
      process.exitCode = 1;
    }
  });
} catch {
  console.error("EventOS media archive validation failed.");
  process.exitCode = 1;
}
