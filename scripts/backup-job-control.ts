import { z } from "zod";
import { BackupRepository } from "../src/modules/platform/backups/repository";
import { closeControlPool } from "../src/infrastructure/db/control/pool";
// Local image CLI only. No Docker, shell or backup-directory access in this process.
try {
  const [command, id, key, size, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Unexpected arguments");
  const repository = new BackupRepository();
  let result: unknown;
  switch (command) {
    case "claim":
      if (id) throw new Error();
      result = await repository.claim();
      break;
    case "metadata":
      if (key || size) throw new Error();
      result = await repository.tenantMetadata(z.uuid().parse(id));
      break;
    case "mark-verifying":
      if (key || size) throw new Error();
      result = await repository.transition(z.uuid().parse(id), "VERIFYING");
      break;
    case "complete":
      result = await repository.transition(z.uuid().parse(id), "SUCCEEDED", {
        backupKey: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/)
          .parse(key),
        sizeBytes: z
          .string()
          .regex(/^\d{1,19}$/)
          .parse(size),
      });
      break;
    case "fail":
      if (key || size) throw new Error();
      result = await repository.transition(z.uuid().parse(id), "FAILED");
      break;
    default:
      throw new Error();
  }
  process.stdout.write(`${JSON.stringify({ data: result })}\n`);
} catch {
  process.stdout.write('{"error":"BACKUP_CONTROL_FAILED"}\n');
  process.exitCode = 1;
} finally {
  await closeControlPool();
}
