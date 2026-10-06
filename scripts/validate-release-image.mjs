import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";

const image = process.argv[2];
if (!image) throw new Error("Image required");
const inspect = JSON.parse(
  execFileSync("docker", ["image", "inspect", image], { encoding: "utf8" }),
)[0];
if (
  inspect.Os !== "linux" ||
  inspect.Architecture !== "amd64" ||
  !inspect.Config.User ||
  /^(root|0)(:|$)/.test(inspect.Config.User)
)
  throw new Error("Release image must be linux/amd64 and non-root");
const control = readdirSync("src/infrastructure/db/control/migrations").filter(
  (file) => file.endsWith(".sql"),
);
const tenant = readdirSync("prisma/tenant/migrations").filter((file) =>
  /^\d/.test(file),
);
const required = [
  "standalone/server.js",
  "scripts/windows-iis-preflight.mjs",
  "scripts/db-migrate.ts",
  "scripts/migrate-tenant-databases.ts",
  "scripts/provisioning-worker.ts",
  "scripts/migrate-local-media-to-s3.ts",
  ...control.map((file) => `src/infrastructure/db/control/migrations/${file}`),
  ...tenant.map((file) => `prisma/tenant/migrations/${file}/migration.sql`),
];
const verification = `const fs=require('node:fs'); for(const file of ${JSON.stringify(required)}) if(!fs.existsSync('/app/'+file))throw Error('Missing required release file'); if(fs.readdirSync('/app/data/media').length)throw Error('Baked media'); function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name.startsWith('.env')||e.name==='.demo-credentials.local'||e.name==='.local')throw Error('Development file in image');if(e.isDirectory())scan(dir+'/'+e.name)}}scan('/app');if(process.getuid()===0)throw Error('Root runtime');`;
execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--entrypoint",
    "node",
    image,
    "-e",
    verification,
  ],
  { stdio: "inherit" },
);
const env = {
  NODE_ENV: "production",
  MAIL_TRANSPORT: "disabled",
  SMS_TRANSPORT: "provider",
  PLATFORM_BASE_DOMAIN: "mediasanat.ir",
  BETTER_AUTH_URL: "https://event.mediasanat.ir",
  PLATFORM_REQUIRE_MFA: "false",
  MEDIA_STORAGE_DRIVER: "local",
  MEDIA_LOCAL_ROOT: "/app/data/media",
  BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
  TENANT_BOOTSTRAP_ENCRYPTION_KEY: randomBytes(48).toString("hex"),
};
for (const [key, role, database] of [
  ["CONTROL_DATABASE_URL", "eventos_control_app", "eventos_control"],
  [
    "CONTROL_MIGRATION_DATABASE_URL",
    "eventos_control_migrator",
    "eventos_control",
  ],
  ["CONTROL_QUEUE_DATABASE_URL", "eventos_control_queue", "eventos_control"],
  [
    "TENANT_PROVISIONING_DATABASE_URL",
    "eventos_tenant_provisioner",
    "postgres",
  ],
  ["TENANT_RUNTIME_DATABASE_URL", "eventos_tenant_runtime", "postgres"],
  ["TENANT_MIGRATION_DATABASE_URL", "eventos_tenant_migrator", "postgres"],
])
  env[key] =
    `postgresql://${role}:${randomBytes(32).toString("hex")}@postgres:5432/${database}`;
// Random synthetic validation values travel via inherited environment, never arguments/logs.
execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    ...Object.keys(env).flatMap((key) => ["--env", key]),
    "--entrypoint",
    "node",
    image,
    "scripts/windows-iis-preflight.mjs",
    "--runtime-only",
  ],
  { env: { ...process.env, ...env }, stdio: "inherit" },
);
console.log(
  `Release image validated: linux/amd64, non-root, ${control.length} control and ${tenant.length} tenant migrations, empty media, no development files.`,
);
