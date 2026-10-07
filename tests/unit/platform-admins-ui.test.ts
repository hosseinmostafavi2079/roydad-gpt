// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  host: "localhost:3000",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => "/platform/admins",
  notFound: () => {
    throw new Error("Not found");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: mocks.host }),
}));
vi.mock("@/shared/config/env", () => ({
  getServerConfig: () => ({ BETTER_AUTH_URL: "http://localhost:3000" }),
}));
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformPageAdmin: mocks.auth,
}));

import { PlatformActivationForm } from "@/app/_components/platform-activation-form";
import { PlatformAdminsCenter } from "@/app/_components/platform-admins-center";
import { PlatformNav } from "@/app/_components/platform-nav";
import Page from "@/app/platform/admins/page";
import ActivationPage from "@/app/platform-activation/page";

let root: Root,
  host: HTMLDivElement,
  fetchMock: ReturnType<typeof vi.fn>,
  activeCount: number;
const items = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Current Admin",
    email: "admin@example.test",
    status: "ACTIVE",
    createdAt: "2026-10-01",
    activatedAt: "2026-10-01",
    revokedAt: null,
    mfaEnabled: true,
    isCurrent: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Pending Admin",
    email: "pending@example.test",
    status: "PENDING_ACTIVATION",
    createdAt: "2026-10-01",
    activatedAt: null,
    revokedAt: null,
    mfaEnabled: false,
    isCurrent: false,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Revoked Admin",
    email: "revoked@example.test",
    status: "REVOKED",
    createdAt: "2026-10-01",
    activatedAt: "2026-10-01",
    revokedAt: "2026-10-02",
    mfaEnabled: false,
    isCurrent: false,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.host = "localhost:3000";
  mocks.auth.mockResolvedValue({ adminId: items[0]?.id });
  activeCount = 1;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      data:
        init?.method === "POST"
          ? { activationCode: "unit-only-fake-code" }
          : { items, activeCount },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(component = PlatformAdminsCenter) {
  await act(async () => root.render(createElement(component)));
}
async function click(text: string) {
  await act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (value) => value.textContent?.trim() === text,
    );
    if (!button) throw new Error("Button missing");
    button.click();
  });
}
async function submit(values: Record<string, string>) {
  await act(async () => {
    for (const [name, value] of Object.entries(values)) {
      const input = host.querySelector(
        `input[name=${name}]`,
      ) as HTMLInputElement;
      input.value = value;
    }
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("admin page guards before rendering", async () => {
  mocks.auth.mockRejectedValueOnce(new Error("Denied"));
  await expect(Page()).rejects.toThrow("Denied");
  expect((await Page()).type).toBe(PlatformAdminsCenter);
});
it("activation page is outside auth layout, only on canonical platform host", async () => {
  expect((await ActivationPage()).type).toBe("main");
  mocks.host = "custom.example.test";
  await expect(ActivationPage()).rejects.toThrow("Not found");
});
it("adds admins navigation and preserves every existing option", async () => {
  await act(async () =>
    root.render(createElement(PlatformNav, { requireMfa: true })),
  );
  for (const route of [
    "/platform",
    "/platform/tenants",
    "/platform/plans",
    "/platform/backups",
    "/platform/diagnostics",
    "/platform/security/mfa",
    "/platform/admins",
  ])
    expect(host.querySelector(`a[href='${route}']`)).not.toBeNull();
});
it.each([
  "در انتظار فعال‌سازی",
  "فعال",
  "غیرفعال‌شده",
  "حساب شما",
  "ثبت‌شده",
  "ثبت نشده",
])("renders safe lifecycle/account text %s", async (text) => {
  await render();
  expect(host.textContent).toContain(text);
});
it("shows lifecycle-appropriate actions and no permanent deletion", async () => {
  await render();
  const cards = host.querySelectorAll("article");
  expect(cards[0]?.textContent).toContain("خروج از همه دستگاه‌ها");
  expect(cards[1]?.textContent).toContain("تولید مجدد کد فعال‌سازی");
  expect(cards[2]?.textContent).toContain("فعال‌سازی مجدد");
  expect(host.textContent).not.toContain("حذف دائمی");
});
it("only active last admin revoke is disabled with explanation", async () => {
  await render();
  const buttons = host.querySelectorAll<HTMLButtonElement>(
    "article:first-child button",
  );
  expect(
    Array.from(buttons).find((value) => value.textContent === "غیرفعال‌کردن")
      ?.disabled,
  ).toBe(true);
  expect(host.textContent).toContain("حداقل یک مدیر فعال");
});
it("create form collects only name/email, exposes one-time panel and clears code on close", async () => {
  const local = vi.spyOn(Storage.prototype, "setItem");
  await render();
  await click("افزودن مدیر جدید");
  expect(host.querySelector("input[type=password]")).toBeNull();
  await submit({ displayName: "New Admin", email: "new@example.test" });
  expect(
    fetchMock.mock.calls.some(
      (call) =>
        call[1]?.method === "POST" &&
        call[1]?.body ===
          JSON.stringify({
            displayName: "New Admin",
            email: "new@example.test",
          }),
    ),
  ).toBe(true);
  expect(host.textContent).toContain("کد فعال‌سازی فقط همین یک بار");
  expect(host.querySelector("output")?.textContent).toBe("unit-only-fake-code");
  expect(local).not.toHaveBeenCalled();
  await click("بستن");
  expect(host.querySelector("output")?.textContent).toBe("");
});
it("regeneration uses confirmation and displays fresh code", async () => {
  await render();
  await click("تولید مجدد کد فعال‌سازی");
  expect(fetchMock.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  await click("تأیید");
  expect(
    fetchMock.mock.calls.some((call) =>
      call[0].endsWith("/activation/regenerate"),
    ),
  ).toBe(true);
  expect(host.querySelector("output")?.textContent).toBe("unit-only-fake-code");
});
it("self session revocation requires confirmation and returns to sign-in", async () => {
  await render();
  await click("خروج از همه دستگاه‌ها");
  await click("تأیید");
  expect(mocks.replace).toHaveBeenCalledWith("/sign-in");
});
it("fetch failure displays generic safe message", async () => {
  fetchMock.mockRejectedValue(new Error("sensitive raw details"));
  await render();
  expect(host.textContent).toContain("دریافت فهرست مدیران ممکن نشد");
  expect(host.textContent).not.toContain("sensitive");
});
it("activation form uses bounded personal passwords, no storage or automatic session", async () => {
  await render(PlatformActivationForm);
  expect(
    host.querySelector("input[name=password]")?.getAttribute("minlength"),
  ).toBe("24");
  const storage = vi.spyOn(Storage.prototype, "setItem");
  await submit({
    email: "new@example.test",
    activationCode: "unit-only-fake-code",
    password: "A sufficiently long personal password",
    confirmPassword: "A sufficiently long personal password",
  });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/platform-activation");
  expect(host.textContent).toContain("حساب مدیر فعال شد");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/sign-in");
  expect(storage).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(host.querySelector("input")).toBeNull();
});
it("activation mismatch rejected without network", async () => {
  await render(PlatformActivationForm);
  await submit({
    email: "new@example.test",
    activationCode: "fake-code",
    password: "A sufficiently long personal password",
    confirmPassword: "A different sufficiently long password",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.querySelector("[role=alert]")).not.toBeNull();
});
it("activation error never exposes raw server details", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ error: "secret raw stack" }),
  });
  await render(PlatformActivationForm);
  await submit({
    email: "new@example.test",
    activationCode: "fake-code",
    password: "A sufficiently long personal password",
    confirmPassword: "A sufficiently long personal password",
  });
  expect(host.textContent).toContain("اطلاعات فعال‌سازی معتبر نیست");
  expect(host.textContent).not.toContain("stack");
});
