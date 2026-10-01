const eventPath = /^\/events\/[a-z0-9][a-z0-9-]{0,99}$/;

export function safeParticipantDestination(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 120) return null;
  if (value === "/account" || eventPath.test(value)) return value;
  return null;
}

export function participantLoginPath(next: string): string {
  const destination = safeParticipantDestination(next) ?? "/account";
  return `/login?participant=1&next=${encodeURIComponent(destination)}`;
}
