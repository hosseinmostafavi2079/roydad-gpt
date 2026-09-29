import "server-only";

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { logger } from "@/infrastructure/logging/logger";

type Migration = Readonly<{ version: string; checksum: string; sql: string }>;

async function readMigrations(directory: string): Promise<Migration[]> {
  const files = (await readdir(directory))
    .filter((file) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    migrations.push({
      version: file.slice(0, -4),
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    });
  }
  return migrations;
}

export async function applySqlMigrations(
  client: Client,
  directory: string,
  lockName: string,
): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS eventos_schema_migrations (
       version varchar(120) PRIMARY KEY,
       checksum char(64) NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
    lockName,
  ]);

  try {
    const migrations = await readMigrations(directory);
    const existing = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM eventos_schema_migrations",
    );
    const applied = new Map(
      existing.rows.map((row) => [row.version, row.checksum]),
    );

    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.version);
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Applied migration ${migration.version} has changed; add a new forward migration.`,
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO eventos_schema_migrations (version, checksum) VALUES ($1, $2)",
          [migration.version, migration.checksum],
        );
        await client.query("COMMIT");
        logger.info(
          { migration: migration.version },
          "Database migration applied",
        );
      } catch (error) {
        await client.query("ROLLBACK");
        logger.error(
          {
            migration: migration.version,
            errorName: error instanceof Error ? error.name : "unknown",
            errorCode:
              typeof error === "object" && error !== null && "code" in error
                ? error.code
                : undefined,
          },
          "Database migration failed",
        );
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        lockName,
      ]);
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Could not release database migration advisory lock; the connection will close",
      );
    }
  }
}
