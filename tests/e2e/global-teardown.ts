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
  }
  unlinkSync(serverStatePath);
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
        await provisioner.query(`DROP DATABASE IF EXISTS "${name}"`);
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
