import { describe, expect, it } from "vitest";
import {
  formatTenantDate,
  formatTenantWallInput,
  tenantWallTimeToUtc,
} from "@/modules/program-core/dates";
import {
  mayTransition,
  programTransitions,
  runTransitions,
  timeRangesOverlap,
} from "@/modules/program-core/domain";
import { runInput, sessionInput } from "@/modules/program-core/schema";
import { authorizeResource } from "@/modules/tenant-identity/permissions";

const start = new Date("2026-10-10T09:00:00.000Z"),
  end = new Date("2026-10-10T11:00:00.000Z");
const run = {
  programId: "d252023a-d538-4422-99fd-67f0c477a687",
  title: "Autumn",
  startsAt: start.toISOString(),
  endsAt: end.toISOString(),
  registrationStartsAt: null,
  registrationEndsAt: null,
  deliveryMode: "IN_PERSON",
  capacity: 20,
  minimumCapacity: 5,
  waitlistEnabled: false,
  venueId: null,
  instructorIds: [],
  notes: "",
};
const session = {
  runId: run.programId,
  title: "First session",
  startsAt: start.toISOString(),
  endsAt: end.toISOString(),
  timezone: "Asia/Tehran",
  deliveryMode: "IN_PERSON",
  venueId: null,
  roomId: null,
  instructorIds: [],
  notes: "",
};

describe("Phase 3 program rules", () => {
  it("permits only controlled program and run transitions", () => {
    expect(mayTransition("DRAFT", "ACTIVE", programTransitions)).toBe(true);
    expect(mayTransition("ARCHIVED", "ACTIVE", programTransitions)).toBe(false);
    expect(mayTransition("DRAFT", "PUBLISHED", runTransitions)).toBe(true);
    expect(mayTransition("PUBLISHED", "DRAFT", runTransitions)).toBe(false);
    expect(mayTransition("CANCELLED", "PUBLISHED", runTransitions)).toBe(false);
  });
  it("validates run periods and capacity", () => {
    expect(runInput.safeParse(run).success).toBe(true);
    expect(
      runInput.safeParse({ ...run, endsAt: start.toISOString() }).success,
    ).toBe(false);
    expect(runInput.safeParse({ ...run, minimumCapacity: 21 }).success).toBe(
      false,
    );
    expect(
      runInput.safeParse({
        ...run,
        registrationStartsAt: end.toISOString(),
        registrationEndsAt: start.toISOString(),
      }).success,
    ).toBe(false);
  });
  it("validates session times and half-open overlap boundaries", () => {
    expect(sessionInput.safeParse(session).success).toBe(true);
    expect(
      sessionInput.safeParse({ ...session, endsAt: start.toISOString() })
        .success,
    ).toBe(false);
    expect(
      timeRangesOverlap(
        { startsAt: start, endsAt: end },
        { startsAt: end, endsAt: new Date(end.getTime() + 3600000) },
      ),
    ).toBe(false);
    expect(
      timeRangesOverlap(
        { startsAt: start, endsAt: end },
        {
          startsAt: new Date(end.getTime() - 1),
          endsAt: new Date(end.getTime() + 3600000),
        },
      ),
    ).toBe(true);
  });
  it("converts tenant wall time to UTC and displays Jalali dates", () => {
    expect(tenantWallTimeToUtc("2026-10-10T12:30", "Asia/Tehran")).toBe(
      start.toISOString(),
    );
    expect(formatTenantWallInput(start, "Asia/Tehran")).toBe(
      "2026-10-10T12:30",
    );
    expect(formatTenantDate(start, "Asia/Tehran")).toMatch(/[۰-۹]/);
  });
  it("rejects nonexistent and ambiguous daylight-saving wall times", () => {
    expect(() =>
      tenantWallTimeToUtc("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      tenantWallTimeToUtc("2026-11-01T01:30", "America/New_York"),
    ).toThrow();
  });
  it("requires both permission and actor relationship for an instructor resource", () => {
    const actor = {
      id: "instructor-a",
      tenantId: "tenant-a",
      permissions: new Set(["session.read"]),
    };
    expect(() =>
      authorizeResource({
        actor,
        permission: "session.read",
        resource: {
          tenantId: "tenant-a",
          authorizedActorIds: ["instructor-a"],
        },
      }),
    ).not.toThrow();
    expect(() =>
      authorizeResource({
        actor,
        permission: "session.read",
        resource: {
          tenantId: "tenant-a",
          authorizedActorIds: ["instructor-b"],
        },
      }),
    ).toThrow();
    expect(() =>
      authorizeResource({
        actor,
        permission: "session.read",
        resource: {
          tenantId: "tenant-b",
          authorizedActorIds: ["instructor-a"],
        },
      }),
    ).toThrow();
  });
});
