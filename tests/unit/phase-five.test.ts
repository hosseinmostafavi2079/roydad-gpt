import { describe, expect, it } from "vitest";
import { attendancePercentage } from "@/modules/attendance/schema";
import {
  checkInWindow,
  signQrChallenge,
  verifyQrChallenge,
} from "@/modules/attendance/qr";
import {
  fillTemplate,
  validateTemplateMessage,
} from "@/modules/certificates/schema";
import { renderCertificatePdf } from "@/modules/certificates/pdf";

const tenantId = "11000000-0000-4000-8000-000000000001";
const otherTenantId = "22000000-0000-4000-8000-000000000002";
const sessionId = "33000000-0000-4000-8000-000000000003";
const challengeId = "44000000-0000-4000-8000-000000000004";

describe("Phase 5 attendance and certificate rules", () => {
  it("signs a short-lived tenant-bound QR and rejects tampering, cross-tenant use, and expiry", () => {
    const now = new Date("2026-09-30T10:00:00Z");
    const token = signQrChallenge(
      {
        version: 1,
        tenantId,
        sessionId,
        challengeId,
        expiresAt: Math.floor(now.getTime() / 1000) + 90,
      },
      "test-secret",
    );
    expect(
      verifyQrChallenge(token, "test-secret", tenantId, now).sessionId,
    ).toBe(sessionId);
    expect(() =>
      verifyQrChallenge(`${token}x`, "test-secret", tenantId, now),
    ).toThrow();
    expect(() =>
      verifyQrChallenge(token, "test-secret", otherTenantId, now),
    ).toThrow();
    expect(() =>
      verifyQrChallenge(
        token,
        "test-secret",
        tenantId,
        new Date(now.getTime() + 90_000),
      ),
    ).toThrow();
  });
  it("keeps check-in within the scheduled window and computes attendance percentage", () => {
    const start = new Date("2026-09-30T10:00:00Z");
    const end = new Date("2026-09-30T11:00:00Z");
    expect(checkInWindow(start, end, new Date("2026-09-30T09:00:00Z"))).toBe(
      true,
    );
    expect(checkInWindow(start, end, new Date("2026-09-30T08:59:59Z"))).toBe(
      false,
    );
    expect(checkInWindow(start, end, new Date("2026-09-30T11:30:01Z"))).toBe(
      false,
    );
    expect(attendancePercentage(3, 4)).toBe(75);
    expect(attendancePercentage(0, 0)).toBe(0);
  });
  it("accepts only controlled certificate placeholders", () => {
    validateTemplateMessage("{{participantName}} / {{programName}}");
    expect(() => validateTemplateMessage("{{email}}")).toThrow();
    expect(
      fillTemplate("{{participantName}} - {{issuedAt}}", {
        participantName: "علی",
        programName: "دوره",
        instructorName: "مدرس",
        issuedAt: "۱۴۰۵",
      }),
    ).toBe("علی - ۱۴۰۵");
  });
  it("renders a private PDF with the installed Persian font", async () => {
    const pdf = await renderCertificatePdf({
      participantName: "علی",
      programName: "دوره",
      instructorName: "مدرس",
      organizationName: "سازمان",
      issuedAt: new Date("2026-09-30T10:00:00Z"),
      serialNumber: "EV-123",
      verificationUrl: "https://example.com/certificate/code",
      fields: {
        message: "{{participantName}}",
        showOrganizationLogo: false,
        accentColor: "#174b57",
      },
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
