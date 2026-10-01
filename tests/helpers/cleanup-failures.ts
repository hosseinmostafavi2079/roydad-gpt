export function reportCleanupFailures(
  message: string,
  failures: unknown[],
  originalError?: unknown,
): void {
  if (failures.length === 0) return;
  if (originalError) {
    console.error(message, failures);
    return;
  }
  throw new AggregateError(failures, message);
}
