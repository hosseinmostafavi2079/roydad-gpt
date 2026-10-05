// Test process preload only. Never imported by application/domain-core source.
import { Resolver } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const file = path.resolve(process.env.EVENTOS_E2E_DOMAIN_DNS_FILE ?? "");
if (
  process.env.EVENTOS_E2E_SERVER_PID_FILE !== "tests/.e2e-server.json" ||
  !file.startsWith(`${path.resolve(os.tmpdir())}${path.sep}eventos-e2e-domain-`)
)
  throw new Error("Invalid E2E DNS fixture configuration");
Resolver.prototype.resolveTxt = async (name) => {
  if (!name.endsWith(".domain-ui.example"))
    throw new Error("E2E DNS lookup denied");
  const records = JSON.parse(await readFile(file, "utf8"));
  const value = records[name];
  if (typeof value !== "string")
    throw new Error("E2E DNS record not yet published");
  return [[value]];
};
