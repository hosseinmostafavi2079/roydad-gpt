import { describe, expect, it } from "vitest";
import {
  defaultSiteSettings,
  normalizeSiteSettings,
  sectionIds,
  siteSettingsInput,
} from "@/modules/public-site/profile";
import {
  instructorContentInput,
  mapPublicInstructor,
  publicSlug,
} from "@/modules/public-site/instructors";
import {
  informationPageInput,
  pageSlug,
  siteEntryInput,
} from "@/modules/public-site/content";
import { validateMedia } from "@/modules/media/validation";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SafeRichText } from "@/app/_components/safe-rich-text";
import { PublicEventArtwork } from "@/app/_components/public-event-artwork";

describe("Pilot public site validation", () => {
  it("keeps older website section order while appending new safe sections", () => {
    const result = normalizeSiteSettings({
      sectionOrder: ["hero", "about"],
      sections: { hero: true },
    });
    expect(result.sectionOrder.slice(0, 2)).toEqual(["hero", "about"]);
    expect(result.sectionOrder).toHaveLength(sectionIds.length);
    expect(result.sections.faq).toBe(false);
  });

  it("rejects duplicated or incomplete section order and unsafe CTA URLs", () => {
    expect(
      siteSettingsInput.safeParse({
        ...defaultSiteSettings,
        sectionOrder: ["hero", "hero"],
      }).success,
    ).toBe(false);
    expect(
      siteSettingsInput.safeParse({
        ...defaultSiteSettings,
        heroSecondaryHref: "//evil.example",
      }).success,
    ).toBe(false);
    expect(
      siteSettingsInput.safeParse({
        ...defaultSiteSettings,
        heroSecondaryHref: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("keeps controlled section presets and rejects arbitrary styles", () => {
    const featuredRunId = crypto.randomUUID();
    const settings = normalizeSiteSettings({
      sectionDesigns: {
        featured: {
          layout: "FEATURE",
          background: "DARK",
          spacing: "COMPACT",
          width: "WIDE",
          decoration: "LINES",
        },
      },
      animationIntensity: "OFF",
      featuredRunIds: [featuredRunId],
      featuredCategories: ["آموزش"],
      categoryPresentation: {
        آموزش: {
          description: "دوره‌های آموزشی",
          imageUrl: "",
          icon: "BOOK",
          order: 1,
        },
      },
    });
    expect(settings.sectionDesigns.featured?.background).toBe("DARK");
    expect(settings.animationIntensity).toBe("OFF");
    expect(settings.featuredRunIds).toEqual([featuredRunId]);
    expect(settings.categoryPresentation["آموزش"]?.icon).toBe("BOOK");
    expect(
      siteSettingsInput.safeParse({
        ...settings,
        categoryPresentation: {
          آموزش: {
            description: "",
            imageUrl: "javascript:alert(1)",
            icon: "BOOK",
            order: 1,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      siteSettingsInput.safeParse({
        ...settings,
        sectionDesigns: {
          featured: {
            ...settings.sectionDesigns.featured,
            background: "url(javascript:alert(1))",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("renders a branded event cover when no image is configured", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicEventArtwork, {
        src: null,
        title: "دوره نمونه",
        category: "آموزش",
        type: "COURSE",
      }),
    );
    expect(markup).toContain("دوره نمونه");
    expect(markup).not.toContain("<img");
  });

  it("rejects unsafe page slugs, executable blocks and external CTAs", () => {
    expect(pageSlug.safeParse("../admin").success).toBe(false);
    expect(pageSlug.safeParse("rules-and-terms").success).toBe(true);
    expect(
      informationPageInput.safeParse({
        slug: "rules",
        title: "قوانین",
        blocks: [
          {
            id: crypto.randomUUID(),
            type: "cta",
            text: "ببینید",
            href: "https://evil.example",
          },
        ],
        seoTitle: "",
        metaDescription: "",
        published: true,
      }).success,
    ).toBe(false);
    expect(
      informationPageInput.safeParse({
        slug: "rules",
        title: "قوانین",
        blocks: [{ id: crypto.randomUUID(), type: "script", text: "alert(1)" }],
        seoTitle: "",
        metaDescription: "",
        published: true,
      }).success,
    ).toBe(false);
  });

  it("keeps private staff fields out of the published instructor mapping", () => {
    const content = instructorContentInput.parse({
      name: "مدرس نمونه",
      title: "مدرس",
      shortBio: "معرفی",
      biography: "رزومه",
      specialties: ["آموزش"],
      yearsExperience: null,
      experience: [],
      education: [],
      certifications: [],
      honors: [],
      books: [],
      publications: [],
      projects: [],
      websiteUrl: "",
      linkedInUrl: "",
      photoUrl: "",
      resumeUrl: "",
      showResume: false,
      showExperience: false,
      showEducation: false,
      showWorks: false,
    });
    const result = mapPublicInstructor({
      id: crypto.randomUUID(),
      slug: "sample-teacher",
      published: true,
      content,
      user_id: "private",
      email: "private@example.test",
    } as Parameters<typeof mapPublicInstructor>[0]);
    expect(result).not.toHaveProperty("user_id");
    expect(result).not.toHaveProperty("email");
    expect(result.resumeUrl).toBe("");
    expect(publicSlug.safeParse("../teacher").success).toBe(false);
  });

  it("accepts structured FAQ and rejects unsafe media or malformed PDF", () => {
    expect(
      siteEntryInput.safeParse({
        enabled: true,
        order: 0,
        content: { kind: "FAQ", question: "چگونه؟", answer: "از صفحه رویداد." },
      }).success,
    ).toBe(true);
    expect(
      siteEntryInput.safeParse({
        enabled: true,
        order: 0,
        content: {
          kind: "GALLERY",
          imageUrl: "https://other.example/a.png",
          alt: "",
          caption: "",
        },
      }).success,
    ).toBe(false);
    expect(() =>
      validateMedia(
        "INSTRUCTOR_RESUME",
        "application/pdf",
        new Uint8Array([1, 2, 3]),
      ),
    ).toThrow();
  });

  it("renders limited formatting without executing HTML or external links", () => {
    const html = renderToStaticMarkup(
      createElement(SafeRichText, {
        text: "<script>alert(1)</script> **bold** *italic* [local](/events) [outside](https://evil.example)",
      }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="/events"');
    expect(html).not.toContain('href="https://evil.example"');
  });
});
