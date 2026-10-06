import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { LocalMediaStorage } from "../src/infrastructure/media/local";

process.loadEnvFile(".env");
if (
  process.env.NODE_ENV === "production" ||
  process.env.CI ||
  process.env.PLATFORM_BASE_DOMAIN !== "localhost" ||
  process.env.MEDIA_STORAGE_DRIVER !== "local" ||
  process.argv.slice(2).some((arg) => arg !== "--apply")
)
  throw new Error("Local development transfer only.");
const root = path.resolve(".local/eventos-media");
if (path.resolve(process.env.MEDIA_LOCAL_ROOT ?? "") !== root)
  throw new Error("Generated development media root required.");
const source = new LocalMediaStorage(root);
const child = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "app",
    "node",
    "--conditions=react-server",
    "--import=tsx",
    "scripts/import-development-media.ts",
    ...(process.argv.includes("--apply") ? ["--apply"] : []),
  ],
  { stdio: ["pipe", "inherit", "inherit"], windowsHide: true },
);
const completion = new Promise<number | null>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
child.stdin.on("error", () => {}); // The child exit status below owns transfer failure reporting.
try {
  for (const key of await source.listKeys()) {
    const bytes = await source.get(key);
    const line =
      JSON.stringify({
        key,
        body: Buffer.from(bytes).toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }) + "\n";
    if (!child.stdin.write(line))
      await Promise.race([
        once(child.stdin, "drain"),
        completion.then(() => {
          throw new Error("Development import stopped.");
        }),
      ]);
  }
  child.stdin.end();
  if ((await completion) !== 0) process.exitCode = 1;
} catch {
  child.stdin.end();
  await completion.catch(() => null);
  console.error(
    "Development media transfer failed; source and metadata retained.",
  );
  process.exitCode = 1;
}
