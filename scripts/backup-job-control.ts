import { z } from "zod";
import { closeControlPool } from "../src/infrastructure/db/control/pool";
import { BackupRepository } from "../src/modules/platform/backups/repository";
import { upsertComponentHeartbeat } from "../src/modules/platform/diagnostics/service";

// Local image CLI only. No Docker, shell or backup-directory access in this process.
try {
  const [command, id, key, size, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Unexpected arguments");
  const diagnosticWarning = () => {
    process.stderr.write("Diagnostic recording unavailable.\n");
  };
  const repository = new BackupRepository(undefined, diagnosticWarning);
  let result: unknown;
  switch (command) {
    case "claim-delete":
      if (id) throw new Error();
      result = await repository.claimDeletion();
      break;
    case "check-delete":
    case "complete-delete":
    case "fail-delete": {
      if (size) throw new Error();
      const requestId = z.uuid().parse(id);
      const backupKey = z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/)
        .parse(key);
      result =
        command === "check-delete"
          ? await repository.checkDeletion(requestId, backupKey)
          : command === "complete-delete"
            ? await repository.completeDeletion(requestId, backupKey)
            : await repository.failDeletion(requestId, backupKey);
      break;
    }
    case "enqueue-due":
      if (id) throw new Error();
      result = await repository.enqueueDueScheduledBackup();
      break;
    case "retention":
      if (key || size) throw new Error();
      result = await repository.retentionCandidates(z.uuid().parse(id));
      break;
    case "retry-prunes":
      if (id) throw new Error();
      result = await repository.retryPruneCandidates();
      break;
    case "check-prune":
      if (size) throw new Error();
      result = await repository.checkPruneCandidate(
        z.uuid().parse(id),
        z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/)
          .parse(key),
      );
      break;
    case "mark-pruned":
      if (size) throw new Error();
      result = await repository.markPruned(
        z.uuid().parse(id),
        z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/)
          .parse(key),
      );
      break;
    case "claim":
      if (id) throw new Error();
      await upsertComponentHeartbeat("BACKUP_RUNNER", diagnosticWarning);
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
