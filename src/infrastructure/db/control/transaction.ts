import "server-only";

import type { PoolClient } from "pg";
import { getControlPool } from "@/infrastructure/db/control/pool";
import { logger } from "@/infrastructure/logging/logger";

export async function withControlTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getControlPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.error(
        {
          errorName:
            rollbackError instanceof Error ? rollbackError.name : "unknown",
          errorCode:
            typeof rollbackError === "object" &&
            rollbackError !== null &&
            "code" in rollbackError
              ? rollbackError.code
              : undefined,
        },
        "Control-plane transaction rollback failed",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
