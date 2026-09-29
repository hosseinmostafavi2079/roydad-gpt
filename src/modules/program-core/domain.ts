export const programTransitions: Readonly<Record<string, readonly string[]>> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: [],
};
export const runTransitions: Readonly<Record<string, readonly string[]>> = {
  DRAFT: ["PRIVATE", "PUBLISHED", "CANCELLED"],
  PRIVATE: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["CANCELLED", "COMPLETED"],
  CANCELLED: [],
  COMPLETED: [],
};
export function mayTransition(
  current: string,
  target: string,
  transitions: Readonly<Record<string, readonly string[]>>,
): boolean {
  return transitions[current]?.includes(target) ?? false;
}
export function timeRangesOverlap(
  first: { startsAt: Date; endsAt: Date },
  second: { startsAt: Date; endsAt: Date },
): boolean {
  return first.startsAt < second.endsAt && first.endsAt > second.startsAt;
}
