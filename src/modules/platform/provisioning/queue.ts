import "server-only";

import { Client } from "pg";
import { PgBoss, type Db } from "pg-boss";
import type { PoolClient } from "pg";
import { getServerConfig } from "@/shared/config/env";
import { logger } from "@/infrastructure/logging/logger";

export const provisioningQueueName = "tenant.provision.v1";

let bossPromise: Promise<PgBoss> | undefined;

export async function getProvisioningBoss(): Promise<PgBoss> {
  if (bossPromise) {
    return bossPromise;
  }

  bossPromise = (async () => {
    const config = getServerConfig();
    const boss = new PgBoss({
      connectionString: config.CONTROL_QUEUE_DATABASE_URL,
      schema: "eventos_queue",
      max: 3,
      connectionTimeoutMillis: 5000,
      application_name: "eventos-provisioning-queue",
    });
    const initializer = new Client({
      connectionString: config.CONTROL_QUEUE_DATABASE_URL,
      application_name: "eventos-provisioning-queue-init",
      connectionTimeoutMillis: 5000,
    });
    boss.on("error", (error) => {
      logger.error(
        {
          error: {
            name: error.name,
            code: "code" in error ? error.code : undefined,
          },
        },
        "Provisioning queue error",
      );
    });
    boss.on("warning", () => logger.warn("Provisioning queue warning"));

    let initializationLockHeld = false;
    try {
      await initializer.connect();
      await initializer.query(
        "SELECT pg_advisory_lock(hashtextextended($1, 0))",
        ["eventos-provisioning-queue-initialize"],
      );
      initializationLockHeld = true;
      await boss.start();
      await boss.createQueue(provisioningQueueName, {
        policy: "standard",
        retryLimit: 0,
        expireInSeconds: 30 * 60,
        deleteAfterSeconds: 30 * 24 * 60 * 60,
      });
      const database = boss.getDb();
      await database.executeSql(
        "GRANT USAGE ON SCHEMA eventos_queue TO eventos_control_app",
      );
      await database.executeSql(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA eventos_queue TO eventos_control_app",
      );
      await database.executeSql(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA eventos_queue TO eventos_control_app",
      );
      await database.executeSql(
        "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_control_queue IN SCHEMA eventos_queue GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eventos_control_app",
      );
      await database.executeSql(
        "ALTER DEFAULT PRIVILEGES FOR ROLE eventos_control_queue IN SCHEMA eventos_queue GRANT USAGE, SELECT ON SEQUENCES TO eventos_control_app",
      );
      return boss;
    } catch (error) {
      bossPromise = undefined;
      try {
        await boss.stop({ graceful: false });
      } catch (stopError) {
        logger.warn(
          {
            errorName: stopError instanceof Error ? stopError.name : "unknown",
          },
          "Could not stop partially initialized provisioning queue",
        );
      }
      throw error;
    } finally {
      if (initializationLockHeld) {
        await initializer
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
            "eventos-provisioning-queue-initialize",
          ])
          .catch((error: unknown) => {
            logger.warn(
              {
                errorName: error instanceof Error ? error.name : "unknown",
              },
              "Could not release provisioning queue initialization lock",
            );
          });
      }
      await initializer.end().catch((error: unknown) => {
        logger.warn(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "Could not close provisioning queue initialization connection",
        );
      });
    }
  })();

  return bossPromise;
}

function transactionDatabase(client: PoolClient): Db {
  return {
    executeSql: async (text, values) => {
      const result = await client.query(text, values as never[] | undefined);
      return { rows: result.rows };
    },
  };
}

export async function enqueueProvisioningInTransaction(
  client: PoolClient,
  input: Readonly<{ jobId: string; tenantId: string; attemptCount?: number }>,
): Promise<string> {
  const boss = await getProvisioningBoss();
  const queueJobId = await boss.send(
    provisioningQueueName,
    { provisioningJobId: input.jobId, tenantId: input.tenantId },
    {
      retryLimit: 0,
      singletonKey: `${input.jobId}:${input.attemptCount ?? 0}`,
      db: transactionDatabase(client),
    },
  );
  if (!queueJobId) {
    throw new Error("Provisioning queue did not return a persistent job ID.");
  }
  return queueJobId;
}

export async function stopProvisioningBoss(): Promise<void> {
  if (!bossPromise) {
    return;
  }
  const boss = await bossPromise;
  bossPromise = undefined;
  await boss.stop({ graceful: true, timeout: 10000 });
}
