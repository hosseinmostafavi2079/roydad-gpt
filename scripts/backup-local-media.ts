import { spawn } from "node:child_process";
import { LocalMediaStorage } from "../src/infrastructure/media/local";

// Invoked only inside the EventOS app container after the exact named mount is checked.
try {
  if (
    process.env.MEDIA_STORAGE_DRIVER !== "local" ||
    process.env.MEDIA_LOCAL_ROOT !== "/app/data/media"
  )
    throw new Error("Unexpected media source");
  await new LocalMediaStorage("/app/data/media").listKeys(); // reject links/non-media files before archiving
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
      ".",
    ],
    { stdio: ["ignore", "inherit", "pipe"] },
  );
  child.stderr.resume(); // tar may print private paths; report only safe failure status
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
