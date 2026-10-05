import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TenantSignInForm } from "@/app/_components/tenant-sign-in-form";
it("hides email inputs and OTP actions while retaining independently enabled Google", () => {
  const html = renderToStaticMarkup(
    createElement(TenantSignInForm, {
      passwordEnabled: false,
      otpEnabled: false,
      googleEnabled: true,
    }),
  );
  expect(html).toContain("ادامه با گوگل");
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain("دریافت کد");
  expect(html).not.toContain('type="submit"');
});
it("does not show an email login form when all its methods are unavailable", () => {
  const html = renderToStaticMarkup(
    createElement(TenantSignInForm, {
      passwordEnabled: false,
      otpEnabled: false,
      googleEnabled: false,
    }),
  );
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain("کد یک‌بارمصرف ایمیلی");
});
