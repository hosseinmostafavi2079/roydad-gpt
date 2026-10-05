import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const buildEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  MAIL_TRANSPORT:
    process.env.MAIL_TRANSPORT === "disabled" ? "disabled" : "smtp",
};
const nextCli = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
const standalonePreparation = fileURLToPath(
  new URL("./prepare-standalone.mjs", import.meta.url),
);

for (const command of [[nextCli, "build"], [standalonePreparation]]) {
  const result = spawnSync(process.execPath, command, {
    env: buildEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
