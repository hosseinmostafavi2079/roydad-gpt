import { describe, expect, it } from "vitest";
import {
  participantLoginPath,
  safeParticipantDestination,
} from "../../src/modules/tenant-identity/auth-destination";
import { googleOAuthEnabledForOrigin } from "../../src/modules/tenant-identity/google-config";

describe("pilot participant auth destinations", () => {
  it("preserves only local account and event paths", () => {
    expect(safeParticipantDestination("/events/course-2026")).toBe(
      "/events/course-2026",
    );
    expect(safeParticipantDestination("/account")).toBe("/account");
    for (const attack of [
      "//evil.example",
      "https://evil.example/events/x",
      "/events/../admin",
      "/events/x?next=https://evil.example",
      "/events/x#fragment",
      "/\\evil.example",
      "/dashboard",
    ])
      expect(safeParticipantDestination(attack)).toBeNull();
    expect(participantLoginPath("//evil.example")).toBe(
      "/login?participant=1&next=%2Faccount",
    );
  });

  it("enables Google only for an exact configured tenant origin", () => {
    const before = {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
      origins: process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS,
    };
    try {
      process.env.GOOGLE_CLIENT_ID = "test-client";
      process.env.GOOGLE_CLIENT_SECRET = "test-secret";
      process.env.GOOGLE_OAUTH_ALLOWED_ORIGINS = "https://tenant.example";
      expect(googleOAuthEnabledForOrigin("https://tenant.example")).toBe(true);
      expect(
        googleOAuthEnabledForOrigin("https://tenant.example.evil.test"),
      ).toBe(false);
      expect(googleOAuthEnabledForOrigin("http://tenant.example")).toBe(false);
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(googleOAuthEnabledForOrigin("https://tenant.example")).toBe(false);
    } finally {
      for (const [key, value] of [
        ["GOOGLE_CLIENT_ID", before.id],
        ["GOOGLE_CLIENT_SECRET", before.secret],
        ["GOOGLE_OAUTH_ALLOWED_ORIGINS", before.origins],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
