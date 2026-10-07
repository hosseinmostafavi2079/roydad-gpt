import { type BackupPolicy, backupPolicySchema } from "./schema";

// Intl owns timezone rules. Select one earliest local slot per calendar date.
// Gaps shift to the first available local minute; overlaps use the first occurrence.
export function nextBackupRun(input: BackupPolicy, after: Date): Date {
  const policy = backupPolicySchema.parse(input);
  if (!Number.isFinite(after.getTime()))
    throw new Error("Invalid scheduling clock");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: policy.timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const seen = new Set<string>();
  const start = Math.floor(after.getTime() / 60000) * 60000 - 36 * 60 * 60000;
  for (
    let instant = start;
    instant <= after.getTime() + 9 * 86400000;
    instant += 60000
  ) {
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}`;
    if (time < policy.executionTime || seen.has(date)) continue;
    seen.add(date);
    if (
      policy.frequency === "WEEKLY" &&
      new Date(`${date}T00:00:00Z`).getUTCDay() !== policy.weekday
    )
      continue;
    if (instant > after.getTime()) return new Date(instant);
  }
  throw new Error("No future backup slot");
}
