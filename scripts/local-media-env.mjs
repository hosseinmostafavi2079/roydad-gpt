import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

export function developmentMediaRoot(workspace) {
  return path.resolve(workspace, ".local", "eventos-media");
}

export function prepareDevelopmentMediaRoot(workspace) {
  const root = developmentMediaRoot(workspace);
  for (const directory of [path.resolve(workspace), path.dirname(root), root]) {
    try {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(
          "Development media directory must be a private directory, not a link.",
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      mkdirSync(directory, { mode: 0o700 });
    }
  }
  return root;
}

export function localMediaEnvironment(
  workspace,
  driver = "local",
  docker = false,
) {
  if (!["local", "s3"].includes(driver))
    throw new Error("Invalid development media driver.");
  return {
    MEDIA_STORAGE_DRIVER: driver,
    MEDIA_LOCAL_ROOT: docker
      ? "/app/data/media"
      : developmentMediaRoot(workspace).replaceAll("\\", "/"),
  };
}
