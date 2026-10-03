import { describe, expect, it } from "vitest";
import {
  createTenantSchema,
  createTenantRequestSchema,
} from "@/modules/platform/tenants/schema";
import { suggestTenantSlug } from "@/modules/platform/tenants/slug";
import {
  provisioningProgressStates,
  provisioningStateLabels,
} from "@/modules/platform/tenants/provisioning-view";

const valid = {
  displayName: "آکادمی فردا",
  slug: "farda",
  ownerName: "مدیر فردا",
  ownerEmail: "OWNER@example.test",
  planCode: "foundation",
};

describe("pilot tenant creation input", () => {
  it("suggests a safe editable ASCII subdomain", () => {
    expect(suggestTenantSlug("آکادمی فردا")).toMatch(/^[a-z0-9-]+$/);
    expect(suggestTenantSlug("Acme Events")).toBe("acme-events");
    expect(suggestTenantSlug("  !!!  ")).toBe("");
  });
  it("requires only name, slug, owner and plan, with safe defaults", () => {
    const parsed = createTenantSchema.parse(valid);
    expect(parsed.legalName).toBeUndefined();
    expect(parsed.ownerEmail).toBe("owner@example.test");
    expect(parsed.preset).toBe("SIMPLE");
    expect(parsed.primaryColor).toBe("#145D58");
  });
  it("rejects hostname manipulation and invalid owner emails", () => {
    for (const slug of ["bad.example", "../bad", "bad/slash", "-bad"]) {
      expect(createTenantSchema.safeParse({ ...valid, slug }).success).toBe(
        false,
      );
    }
    expect(
      createTenantSchema.safeParse({ ...valid, ownerEmail: "invalid" }).success,
    ).toBe(false);
  });
  it("validates explicit idempotency keys and visual presets", () => {
    expect(createTenantRequestSchema.safeParse(valid).success).toBe(false);
    expect(
      createTenantSchema.safeParse({ ...valid, creationKey: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      createTenantSchema.safeParse({ ...valid, preset: "UNREVIEWED" }).success,
    ).toBe(false);
  });
  it("maps real worker states and safe failure phases", () => {
    for (const state of provisioningProgressStates)
      expect(provisioningStateLabels[state]).toBeTruthy();
    expect(provisioningStateLabels.SEEDING).toContain("دعوت مدیر");
    expect(provisioningStateLabels.FAILED_MIGRATION).toBe(
      "خطا در اعمال تغییرات",
    );
  });
});
