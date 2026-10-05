import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdminButton, StatusBadge } from "@/app/_components/admin-ui";

describe("admin action and status language", () => {
  it("renders semantic actions with a visible focusable button", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AdminButton,
        { tone: "danger", icon: "remove", type: "button" },
        "لغو ثبت‌نام",
      ),
    );
    expect(markup).toContain("admin-action-danger");
    expect(markup).toContain("لغو ثبت‌نام");
    expect(markup).toContain('type="button"');
  });

  it("shows Persian account, profile, and enrollment states", () => {
    expect(
      renderToStaticMarkup(createElement(StatusBadge, { status: "ACTIVE" })),
    ).toContain("فعال");
    expect(
      renderToStaticMarkup(createElement(StatusBadge, { status: "PUBLISHED" })),
    ).toContain("منتشرشده");
    expect(
      renderToStaticMarkup(
        createElement(StatusBadge, { status: "AWAITING_PAYMENT" }),
      ),
    ).toContain("در انتظار پرداخت");
    expect(
      renderToStaticMarkup(createElement(StatusBadge, { status: "CANCELLED" })),
    ).toContain("admin-status-danger");
  });
});
