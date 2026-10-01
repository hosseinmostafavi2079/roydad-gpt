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

export function authContinuePath(next: unknown): string {
  const destination = safeParticipantDestination(next);
  return destination
    ? `/auth/continue?next=${encodeURIComponent(destination)}`
    : "/auth/continue";
}

export function safeAuthCallbackDestination(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith("/auth/continue"))
    return false;
  const parsed = new URL(value, "http://localhost");
  return (
    parsed.origin === "http://localhost" &&
    parsed.pathname === "/auth/continue" &&
    (parsed.searchParams.size === 0 ||
      (parsed.searchParams.size === 1 &&
        safeParticipantDestination(parsed.searchParams.get("next")) !== null))
  );
}

export function roleAwareTenantDestination(
  roles: readonly string[],
  next: unknown,
): string {
  const participantOnly =
    roles.length > 0 && roles.every((role) => role === "participant");
  return participantOnly
    ? (safeParticipantDestination(next) ?? "/account")
    : "/dashboard";
}
