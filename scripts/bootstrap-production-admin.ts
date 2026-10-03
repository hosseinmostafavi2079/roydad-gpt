import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { getServerConfig } from "../src/shared/config/env";
import { hashPlatformPassword } from "../src/infrastructure/auth/password";

const config = getServerConfig();
if (config.NODE_ENV !== "production")
  throw new Error(
    "Production administrator bootstrap requires production mode.",
  );
if (process.stdin.isTTY)
  throw new Error(
    "Pipe the email and password to stdin; do not pass secrets as command arguments.",
  );
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.from(chunk));
  if (Buffer.concat(chunks).length > 512)
    throw new Error("Bootstrap input is too large.");
}
const [emailRaw, passwordRaw] = Buffer.concat(chunks)
  .toString("utf8")
  .split(/\r?\n/);
const email = emailRaw?.trim().toLowerCase() ?? "";
const password = passwordRaw ?? "";
if (
  !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
  password.length < 24 ||
  password.length > 128
)
  throw new Error(
    "A valid email and a unique password of 24–128 characters are required.",
  );
const client = new Client({
  connectionString: config.CONTROL_MIGRATION_DATABASE_URL,
  application_name: "eventos-production-admin-bootstrap",
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('eventos-bootstrap-admin', 0))",
  );
  const existing = await client.query(
    "SELECT count(*)::int AS count FROM platform_admins",
  );
  if (existing.rows[0]?.count !== 0)
    throw new Error(
      "A platform administrator already exists; bootstrap is disabled.",
    );
  const userId = randomUUID();
  const adminId = randomUUID();
  const now = new Date();
  const hash = await hashPlatformPassword(password);
  await client.query(
    `INSERT INTO platform_auth_users (id,name,email,"emailVerified","createdAt","updatedAt")
     VALUES ($1,$2,$3,true,$4,$4)`,
    [userId, "Platform Administrator", email, now],
  );
  await client.query(
    `INSERT INTO platform_auth_accounts (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
     VALUES ($1,$2,'credential',$2,$3,$4,$4)`,
    [randomUUID(), userId, hash, now],
  );
  await client.query(
    "INSERT INTO platform_admins (id,auth_user_id,email,display_name) VALUES ($1,$2,$3,$4)",
    [adminId, userId, email, "Platform Administrator"],
  );
  await client.query("COMMIT");
  console.log("Initial platform administrator created.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(
    error instanceof Error &&
      error.message.startsWith("A platform administrator")
      ? error.message
      : "Production administrator bootstrap failed.",
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
