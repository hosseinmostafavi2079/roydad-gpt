import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const setup = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./local-setup.mjs", import.meta.url)), "--env-only"],
  { stdio: "inherit", windowsHide: true },
);
if (setup.error) throw setup.error;
if (setup.status !== 0) process.exit(setup.status ?? 1);
process.loadEnvFile(".env");
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    "dev",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "development",
      MAIL_TRANSPORT:
        process.env.MAIL_TRANSPORT ||
        (process.env.SMTP_URL ? "smtp" : "disabled"),
    },
  },
);
child.on("error", () => {
  console.error("Development server failed to start.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
