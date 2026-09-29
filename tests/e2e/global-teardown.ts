import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import os from "node:os";

type State = {
  adminEmail: string;
  tenantId: string | null;
  tenantSlug: string | null;
  tenants?: Array<{ tenantId: string | null; tenantSlug: string }>;
  mailOutboxPath?: string;
};

function stopE2eServer(): void {
  const serverStatePath = path.join(process.cwd(), "tests", ".e2e-server.json");
  if (!existsSync(serverStatePath)) return;

  const server = JSON.parse(readFileSync(serverStatePath, "utf8")) as {
    pid: number;
    cwd: string;
  };
  const sameWorkspace =
    process.platform === "win32"
      ? server.cwd.toLowerCase() === process.cwd().toLowerCase()
      : server.cwd === process.cwd();
  if (!Number.isSafeInteger(server.pid) || server.pid <= 0 || !sameWorkspace) {
    throw new Error("E2E cleanup refused unexpected server process metadata.");
  }

  if (process.platform === "win32") {
    const stop = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `if (Get-Process -Id ${server.pid} -ErrorAction SilentlyContinue) { Stop-Process -Id ${server.pid} -Force -ErrorAction Stop }`,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    if (stop.error || stop.status !== 0) {
      throw new Error("E2E cleanup could not stop the local test server.");
    }
  } else {
    try {
      process.kill(server.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  unlinkSync(serverStatePath);
}

async function waitForTenantSessionsToClose(
  provisioner: Client,
  databaseName: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (true) {
    const sessions = await tenantSessions(provisioner, databaseName);
    if (sessions.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `E2E tenant database still has sessions: ${JSON.stringify(sessions)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function tenantSessions(provisioner: Client, databaseName: string) {
  const result = await provisioner.query<{
    pid: number;
    application_name: string;
    state: string | null;
  }>(
    `SELECT pid, application_name, state FROM pg_stat_activity
     WHERE datname = $1 ORDER BY pid`,
    [databaseName],
  );
  return result.rows;
}

export default async function globalTeardown(): Promise<void> {
  const statePath = path.join(process.cwd(), "tests", ".e2e-state.json");
  if (!existsSync(statePath)) {
    stopE2eServer();
    return;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
  stopE2eServer();
  const controlUrl = process.env.CONTROL_MIGRATION_DATABASE_URL;
  const provisionerUrl = process.env.TENANT_PROVISIONING_DATABASE_URL;
  const queueUrl = process.env.CONTROL_QUEUE_DATABASE_URL;
  if (!controlUrl || !provisionerUrl || !queueUrl)
    throw new Error("E2E cleanup requires the local PostgreSQL credentials.");
  const control = new Client({
    connectionString: controlUrl,
    application_name: "eventos-e2e-cleanup",
  });
  const provisioner = new Client({
    connectionString: provisionerUrl,
    application_name: "eventos-e2e-cleanup",
  });
  const queue = new Client({
    connectionString: queueUrl,
    application_name: "eventos-e2e-cleanup",
  });
  let cleanupComplete = false;
  try {
    await Promise.all([
      control.connect(),
      provisioner.connect(),
      queue.connect(),
    ]);
    const tenants = state.tenants ?? [];
    if (
      state.tenantSlug &&
      !tenants.some((tenant) => tenant.tenantSlug === state.tenantSlug)
    ) {
      tenants.push({ tenantId: state.tenantId, tenantSlug: state.tenantSlug });
    }
    for (const item of tenants) {
      if (!/^e2e-[0-9a-f]{8}$/.test(item.tenantSlug))
        throw new Error("E2E cleanup refused an unexpected tenant slug.");
      let tenantId = item.tenantId;
      if (!tenantId) {
        const tenant = await control.query<{ id: string }>(
          `SELECT tenant.id FROM tenants AS tenant
           JOIN platform_admins AS admin ON admin.id = tenant.created_by
           WHERE tenant.slug = $1 AND admin.email = $2`,
          [item.tenantSlug, state.adminEmail],
        );
        tenantId = tenant.rows[0]?.id ?? null;
      }
      if (!tenantId) continue;
      await queue.query(
        `DELETE FROM eventos_queue.job
         WHERE name = 'tenant.provision.v1' AND data->>'tenantId' = $1`,
        [tenantId],
      );
      const registry = await control.query<{ database_name: string }>(
        "SELECT database_name FROM tenant_database_registry WHERE tenant_id = $1",
        [tenantId],
      );
      const name = registry.rows[0]?.database_name;
      if (name && /^eventos_t_[0-9a-f]{32}$/.test(name)) {
        await waitForTenantSessionsToClose(provisioner, name);
        try {
          await provisioner.query(`DROP DATABASE IF EXISTS "${name}"`);
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : "unknown";
          const sessions = await tenantSessions(provisioner, name);
          throw new Error(
            `E2E tenant database drop failed (code ${code}); sessions: ${JSON.stringify(sessions)}`,
          );
        }
      }
      await control.query("BEGIN");
      try {
        await control.query(
          "DELETE FROM provisioning_job_transitions WHERE job_id IN (SELECT id FROM provisioning_jobs WHERE tenant_id = $1)",
          [tenantId],
        );
        await control.query(
          "DELETE FROM provisioning_jobs WHERE tenant_id = $1",
          [tenantId],
        );
        await control.query(
          "DELETE FROM tenant_database_registry WHERE tenant_id = $1",
          [tenantId],
        );
        await control.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
        await control.query("COMMIT");
      } catch (error) {
        await control.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    await control.query("DELETE FROM platform_admins WHERE email = $1", [
      state.adminEmail,
    ]);
    await control.query("DELETE FROM platform_auth_users WHERE email = $1", [
      state.adminEmail,
    ]);
    cleanupComplete = true;
  } finally {
    await Promise.all([control.end(), provisioner.end(), queue.end()]);
    if (state.mailOutboxPath) {
      const outbox = path.resolve(state.mailOutboxPath);
      const tempRoot = path.resolve(os.tmpdir());
      if (outbox.startsWith(`${tempRoot}${path.sep}`) && existsSync(outbox))
        unlinkSync(outbox);
    }
    stopE2eServer();
    if (cleanupComplete) unlinkSync(statePath);
  }
}
