import { describe, expect, it } from "vitest";
import {
  gregorianWallToJalali,
  jalaliWallToGregorian,
} from "@/modules/program-core/dates";
import {
  roleLabel,
  SYSTEM_ROLE_LABELS,
} from "@/modules/tenant-identity/role-labels";
import { mediaObjectKey, validateMedia } from "@/modules/media/validation";

describe("Organization Admin presentation boundaries", () => {
  it("labels every built-in role in Persian while preserving role codes", () => {
    expect(Object.keys(SYSTEM_ROLE_LABELS)).toHaveLength(11);
    expect(roleLabel("organization_owner", "Organization Owner")).toBe(
      "مالک مجموعه",
    );
    expect(roleLabel("course_manager", "Course Manager")).toBe("مدیر دوره‌ها");
    expect(roleLabel("custom", "نقش اختصاصی")).toBe("نقش اختصاصی");
  });
  it("converts Nowruz and leap Esfand without changing canonical Gregorian wall time", () => {
    expect(jalaliWallToGregorian(1403, 1, 1, "09:30")).toBe("2024-03-20T09:30");
    expect(jalaliWallToGregorian(1404, 1, 1, "09:30")).toBe("2025-03-21T09:30");
    expect(gregorianWallToJalali("2025-03-20T18:45")).toEqual({
      year: 1403,
      month: 12,
      day: 30,
      time: "18:45",
    });
    expect(() => jalaliWallToGregorian(1404, 12, 30, "09:30")).toThrow();
  });
  it("checks media signatures, sizes and tenant-scoped object keys", () => {
    expect(() =>
      validateMedia(
        "PROGRAM_COVER",
        "image/png",
        Uint8Array.from([0x4d, 0x5a]),
      ),
    ).toThrow();
    expect(() =>
      validateMedia(
        "PROGRAM_VIDEO",
        "video/mp4",
        Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]),
      ),
    ).not.toThrow();
    expect(
      mediaObjectKey("tenant-a", "PROGRAM_COVER", "program-a", "random-id"),
    ).toBe("tenants/tenant-a/programs/program-a/random-id");
  });
});
