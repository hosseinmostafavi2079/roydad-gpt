// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type DiagnosticEvent,
  DiagnosticsCenter,
  exportFilename,
  type Incident,
} from "@/app/_components/diagnostics-center";
import { PlatformNav } from "@/app/_components/platform-nav";
import DiagnosticsPage from "@/app/platform/diagnostics/page";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformPageAdmin: auth,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/platform/diagnostics",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));
const incidentFixture: Incident = {
  id: "11111111-1111-4111-8111-111111111111",
  incidentRef: "INC-20261007-11111111111141118111111111111111",
  status: "OPEN",
  severity: "CRITICAL",
  component: "BACKUP_SYSTEM",
  eventCode: "BACKUP_FAILED",
  tenantId: "22222222-2222-4222-8222-222222222222",
  summary: "تهیه بکاپ ناموفق بود.",
  probableCause: "اجرا یا بررسی بکاپ تکمیل نشده است.",
  firstSeenAt: "2026-10-07T01:00:00Z",
  lastSeenAt: "2026-10-07T02:00:00Z",
  recoveredAt: null,
  occurrenceCount: "2",
  latestRequestId: "33333333-3333-4333-8333-333333333333",
  troubleshooting: ["فضای ذخیره‌سازی", "صحت آرشیو و checksum", "گزارش امن اجرا"],
};
const eventFixture: DiagnosticEvent = {
  id: "44444444-4444-4444-8444-444444444444",
  severity: "ERROR",
  component: "BACKUP_SYSTEM",
  eventCode: "BACKUP_FAILED",
  message: "تهیه بکاپ ناموفق بود.",
  tenantId: incidentFixture.tenantId,
  incidentId: incidentFixture.id,
  requestId: incidentFixture.latestRequestId,
  relatedJobId: null,
  occurredAt: incidentFixture.lastSeenAt as string,
  metadata: {},
};
let root: Root,
  host: HTMLDivElement,
  fetchMock: ReturnType<typeof vi.fn>,
  incidents: Incident[],
  events: DiagnosticEvent[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
  incidents = [];
  events = [];
  auth.mockReset().mockResolvedValue({ adminId: "admin" });
  fetchMock = vi.fn(async (url: string) => {
    let data: unknown;
    if (url.includes("/tenants?"))
      data = {
        items: [
          { id: incidentFixture.tenantId, displayName: "سازمان آزمایشی" },
        ],
      };
    else if (url.endsWith("summary"))
      data = {
        components: [
          { component: "APPLICATION", status: "HEALTHY" },
          { component: "MAIN_WORKER", status: "UNKNOWN" },
          { component: "BACKUP_RUNNER", status: "DEGRADED" },
          { component: "CONTROL_DATABASE", status: "UNAVAILABLE" },
        ],
      };
    else if (url.includes("/events?")) data = events;
    else if (url.endsWith("/export"))
      return {
        ok: true,
        headers: new Headers({
          "content-type": "application/json",
          "content-disposition": `attachment; filename="eventos-incident-${incidentFixture.incidentRef}.json"`,
        }),
        blob: async () => new Blob(['{"safe":true}']),
      };
    else if (url.includes("incidents?")) data = incidents;
    else data = incidentFixture;
    return { ok: true, json: async () => ({ data }) };
  });
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
async function render() {
  await act(async () => root.render(createElement(DiagnosticsCenter)));
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
async function change(id: string, value: string) {
  await act(async () => {
    const element = host.querySelector(`#${id}`) as HTMLInputElement;
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("guards diagnostics page before rendering", async () => {
  auth.mockRejectedValueOnce(new Error("Denied"));
  await expect(DiagnosticsPage()).rejects.toThrow("Denied");
  expect((await DiagnosticsPage()).type).toBe(DiagnosticsCenter);
});
it("adds diagnostics and preserves all navigation including backup/security", async () => {
  await act(async () =>
    root.render(createElement(PlatformNav, { requireMfa: true })),
  );
  for (const href of [
    "/platform",
    "/platform/tenants",
    "/platform/plans",
    "/platform/backups",
    "/platform/diagnostics",
    "/platform/security/mfa",
  ])
    expect(host.querySelector(`a[href='${href}']`)).not.toBeNull();
});
it("renders measured statuses, unknown neutrally and no invented timestamps", async () => {
  await render();
  for (const text of ["سالم", "وضعیت نامشخص", "نیازمند بررسی", "در دسترس نیست"])
    expect(host.textContent).toContain(text);
  expect(
    Array.from(host.querySelectorAll(".admin-status-neutral")).some(
      (value) => value.textContent === "وضعیت نامشخص",
    ),
  ).toBe(true);
  expect(host.textContent).toContain("زمان مشاهده در پاسخ موجود نیست");
  expect(host.textContent).not.toContain("درصد");
});
it("renders empty incident and event states", async () => {
  await render();
  expect(host.textContent).toContain("در حال حاضر رخداد بازی ثبت نشده است");
  expect(host.textContent).toContain("رویداد فنی جدیدی ثبت نشده است");
});
it("renders incident fields and safely maps tenants without per-row requests", async () => {
  incidents = [incidentFixture];
  await render();
  expect(host.textContent).toContain(incidentFixture.incidentRef);
  expect(host.textContent).toContain("سازمان آزمایشی");
  expect(
    fetchMock.mock.calls.filter((call) => call[0].includes("tenants")),
  ).toHaveLength(1);
});
it.each([
  ["INFO", "اطلاع"],
  ["WARNING", "هشدار"],
  ["ERROR", "خطا"],
  ["CRITICAL", "بحرانی"],
])("renders %s severity text", async (severity, label) => {
  incidents = [{ ...incidentFixture, severity }];
  await render();
  expect(host.textContent).toContain(label);
});
it.each([
  ["OPEN", "باز"],
  ["RECOVERED", "برطرف‌شده"],
])("renders %s incident status", async (status, label) => {
  incidents = [{ ...incidentFixture, status }];
  await render();
  expect(host.textContent).toContain(label);
});
it.each([
  ["status", "OPEN"],
  ["severity", "ERROR"],
  ["component", "BACKUP_SYSTEM"],
  ["tenant", "22222222-2222-4222-8222-222222222222"],
  ["incidentRef", incidentFixture.incidentRef],
  ["requestId", incidentFixture.latestRequestId as string],
])("applies validated %s filter", async (key, value) => {
  await render();
  await change(`diag-${key}`, value);
  await submit();
  const param = key === "tenant" ? "tenantId" : key;
  expect(
    fetchMock.mock.calls.some((call) => call[0].includes(`&${param}=${value}`)),
  ).toBe(true);
});
it("clears filters and resets pagination", async () => {
  await render();
  await change("diag-status", "OPEN");
  await submit();
  await click("پاک کردن فیلترها");
  expect((host.querySelector("#diag-status") as HTMLSelectElement).value).toBe(
    "",
  );
  expect(fetchMock.mock.calls.at(-2)?.[0]).toBe(
    "/api/platform/diagnostics/incidents?limit=25&offset=0",
  );
});
it("rejects malformed identifiers before fetching", async () => {
  await render();
  const count = fetchMock.mock.calls.length;
  await change("diag-requestId", "malicious");
  await submit();
  expect(fetchMock.mock.calls).toHaveLength(count);
  expect(host.textContent).toContain("شناسه‌ها و بازه زمانی را بررسی کنید");
});
it("opens details, probable cause, static guidance and recent safe events", async () => {
  incidents = [incidentFixture];
  events = [
    {
      ...eventFixture,
      ...{ stack: "hidden-stack", env: "hidden-env", token: "hidden-token" },
    },
  ];
  await render();
  await click("جزئیات رخداد");
  const dialog = host.querySelector("dialog[open]");
  expect(dialog?.textContent).toContain(incidentFixture.probableCause);
  expect(dialog?.textContent).toContain("صحت آرشیو و checksum");
  expect(dialog?.textContent).toContain("بکاپ ناموفق بود");
  expect(dialog?.textContent).not.toMatch(
    /hidden-stack|hidden-env|hidden-token/,
  );
});
it("downloads only the existing safe export and preserves its allowed filename", async () => {
  incidents = [incidentFixture];
  await render();
  await click("جزئیات رخداد");
  const create = vi.fn(() => "blob:private-report"),
    revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(
        `eventos-incident-${incidentFixture.incidentRef}.json`,
      );
    });
  await click("دریافت گزارش عیب‌یابی");
  expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
    `/api/platform/diagnostics/incidents/${incidentFixture.id}/export`,
  );
  expect(anchor).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("گزارش امن");
});
it("uses a safe fallback filename for path/header injection", () => {
  expect(exportFilename('attachment; filename="../../secret.env"')).toBe(
    "eventos-incident-report.json",
  );
});
it("has no raw-log or infrastructure repair actions", async () => {
  await render();
  expect(
    Array.from(host.querySelectorAll("button")).some((value) =>
      /Docker|لاگ|تعمیر|راه‌اندازی مجدد|restart|repair/.test(
        value.textContent ?? "",
      ),
    ),
  ).toBe(false);
});
it("generic errors do not expose raw messages or falsely claim no incidents", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: "stack SMTP_SECRET" } }),
  });
  await render();
  expect(host.textContent).toContain("دریافت اطلاعات عیب‌یابی با مشکل مواجه شد");
  expect(host.textContent).not.toMatch(
    /stack|SMTP_SECRET|در حال حاضر رخداد بازی/,
  );
});
it("bounded incident and event pagination works", async () => {
  incidents = Array.from({ length: 25 }, (_, index) => ({
    ...incidentFixture,
    id: String(index),
  }));
  events = Array.from({ length: 25 }, (_, index) => ({
    ...eventFixture,
    id: String(index),
  }));
  await render();
  await click("رخدادهای بعدی");
  expect(
    fetchMock.mock.calls.some((call) =>
      call[0].includes("incidents?limit=25&offset=25"),
    ),
  ).toBe(true);
  await click("رویدادهای بعدی");
  expect(
    fetchMock.mock.calls.some((call) =>
      call[0].includes("events?limit=25&offset=25"),
    ),
  ).toBe(true);
});
it("refreshes only on user action without background polling", async () => {
  await render();
  const count = fetchMock.mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(fetchMock.mock.calls).toHaveLength(count);
  await click("بروزرسانی");
  expect(fetchMock.mock.calls).toHaveLength(count + 4);
});
it.each([
  ["2026-10-07", "2026-10-01"],
  ["2026-08-01", "2026-10-07"],
])("rejects invalid date range %s to %s", async (from, to) => {
  await render();
  const count = fetchMock.mock.calls.length;
  await change("diag-from", from);
  await change("diag-to", to);
  await submit();
  expect(fetchMock.mock.calls).toHaveLength(count);
  expect(host.textContent).toContain("بازه حداکثر ۳۱ روز");
});
it("announces loading without claiming empty success", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(host.querySelector("[role=status]")?.textContent).toContain(
    "در حال دریافت",
  );
  expect(host.textContent).not.toContain("در حال حاضر رخداد بازی ثبت نشده است");
});
it("reports failed export safely without raw backend errors", async () => {
  incidents = [incidentFixture];
  await render();
  await click("جزئیات رخداد");
  fetchMock.mockResolvedValueOnce({ ok: false });
  await click("دریافت گزارش عیب‌یابی");
  expect(host.textContent).toContain("دریافت گزارش ممکن نشد");
});
