// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BackupCenter,
  type BackupJob,
  backupStates,
} from "@/app/_components/backup-center";
import { PlatformNav } from "@/app/_components/platform-nav";
import BackupsPage from "@/app/platform/backups/page";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformPageAdmin: auth,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/platform/backups" }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => createElement("a", { href, ...props }, children),
}));
const policy = {
  id: "policy",
  scope: "FULL_PLATFORM",
  enabled: false,
  frequency: "DAILY",
  executionTime: "02:00",
  weekday: null,
  timezone: "Asia/Tehran",
  retentionCount: 7,
  nextRunAt: null,
  lastRunAt: null,
};
const tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "سازمان آزمایشی",
};
const job: BackupJob = {
  id: "22222222-2222-4222-8222-222222222222",
  scope: "FULL_PLATFORM",
  state: "SUCCEEDED",
  tenantId: null,
  triggerType: "MANUAL",
  requestId: "request-safe",
  backupKey: "private-key-not-for-ui",
  sizeBytes: "1048576",
  checksumVerified: true,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-10-07T01:00:00Z",
  updatedAt: "2026-10-07T02:00:00Z",
  startedAt: "2026-10-07T01:00:00Z",
  completedAt: "2026-10-07T02:00:00Z",
  deleteRequest: { state: null },
  canDelete: false,
  deleteProtected: false,
};
let jobs: BackupJob[];
let fetchMock: ReturnType<typeof vi.fn>;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  jobs = [];
  auth.mockReset().mockResolvedValue({ adminId: "admin" });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    let data: unknown;
    if (url.includes("/tenants?")) data = { items: [tenant], pageCount: 1 };
    else if (url.endsWith("/policy"))
      data =
        init?.method === "PATCH"
          ? { ...policy, ...JSON.parse(init.body as string) }
          : policy;
    else if (init?.method === "POST") data = { ...job, state: "QUEUED" };
    else if (url.includes("?limit=")) data = [...jobs];
    else data = jobs[0] ?? job;
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(BackupCenter)));
  await tick(250);
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const button = (text: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (value) => value.textContent?.trim() === text,
  ) as HTMLButtonElement;
async function click(text: string) {
  await act(async () => button(text).click());
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
const mutations = (method: string) =>
  fetchMock.mock.calls.filter((call) => call[1]?.method === method);

it("requires a platform administrator before rendering the page", async () => {
  auth.mockRejectedValueOnce(new Error("Denied"));
  await expect(BackupsPage()).rejects.toThrow("Denied");
  expect(auth).toHaveBeenCalledOnce();
  expect((await BackupsPage()).type).toBe(BackupCenter);
});
it("adds backup navigation and preserves every existing item including conditional security", async () => {
  await act(async () =>
    root.render(createElement(PlatformNav, { requireMfa: true })),
  );
  for (const href of [
    "/platform",
    "/platform/tenants",
    "/platform/plans",
    "/platform/security/mfa",
    "/platform/backups",
  ])
    expect(host.querySelector(`a[href='${href}']`)).not.toBeNull();
});
it("announces loading, renders empty history and disabled policy without destructive actions", async () => {
  await render();
  expect(host.textContent).toContain("هنوز بکاپی");
  expect(host.textContent).toContain("بکاپ خودکار غیرفعال است");
  expect(host.querySelectorAll("button").length).toBeGreaterThan(0);
  for (const text of ["بازیابی", "حذف", "دانلود"])
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (value) =>
          !value.closest("dialog:not([open])") &&
          value.textContent?.includes(text),
      ),
    ).toBe(false);
});
it("renders all six Persian states and safe job fields", async () => {
  jobs = Object.keys(backupStates).map((state, index) => ({
    ...job,
    id: String(index),
    state: state as BackupJob["state"],
  }));
  await render();
  for (const [label] of Object.values(backupStates))
    expect(host.textContent).toContain(label);
  expect(host.textContent).toContain("تأیید شده");
  expect(host.textContent).toContain("request-safe");
  expect(host.textContent).not.toContain(job.backupKey);
});
it("confirms a full backup and displays queued, never completed, status", async () => {
  await render();
  await click("تهیه بکاپ کامل");
  expect(mutations("POST")).toHaveLength(0);
  expect(host.querySelector("dialog[open]")?.textContent).toContain(
    "در صف ایجاد می‌کند",
  );
  await click("ثبت درخواست بکاپ");
  expect(JSON.parse(mutations("POST")[0]?.[1]?.body as string)).toEqual({
    scope: "FULL_PLATFORM",
  });
  expect(host.textContent).toContain("در صف");
  expect(host.textContent).toContain("درخواست بکاپ ثبت شد");
});
it("requires tenant selection and sends only the selected tenant identity", async () => {
  await render();
  expect(button("تهیه بکاپ سازمان").disabled).toBe(true);
  await change("backup-tenant", tenant.id);
  await click("تهیه بکاپ سازمان");
  expect(host.querySelector("dialog[open]")?.textContent).toContain(
    tenant.displayName,
  );
  await click("ثبت درخواست بکاپ");
  expect(JSON.parse(mutations("POST")[0]?.[1]?.body as string)).toEqual({
    scope: "TENANT",
    tenantId: tenant.id,
  });
});
it("loads and saves a daily policy using only accepted fields without enqueuing", async () => {
  await render();
  expect(
    (host.querySelector("#backup-timezone") as HTMLSelectElement).value,
  ).toBe("Asia/Tehran");
  await submit();
  expect(JSON.parse(mutations("PATCH")[0]?.[1]?.body as string)).toEqual({
    enabled: false,
    scope: "FULL_PLATFORM",
    frequency: "DAILY",
    executionTime: "02:00",
    weekday: null,
    timezone: "Asia/Tehran",
    retentionCount: 7,
  });
  expect(mutations("POST")).toHaveLength(0);
});
it("weekly exposes weekday and saves it; daily hides it", async () => {
  await render();
  await change("backup-frequency", "WEEKLY");
  expect(host.querySelector("#backup-weekday")).not.toBeNull();
  await change("backup-weekday", "3");
  await submit();
  expect(JSON.parse(mutations("PATCH")[0]?.[1]?.body as string).weekday).toBe(
    3,
  );
  await change("backup-frequency", "DAILY");
  expect(host.querySelector("#backup-weekday")).toBeNull();
});
it.each(["0", "101", "1.5", ""])(
  "rejects invalid retention %s before PATCH",
  async (value) => {
    await render();
    await change("backup-retention", value);
    await submit();
    expect(mutations("PATCH")).toHaveLength(0);
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  },
);
it("shows only safe errors in fetched details", async () => {
  jobs = [
    {
      ...job,
      state: "FAILED",
      errorCode: "BACKUP_FAILED",
      errorMessage: "Backup execution or verification failed.",
    },
  ];
  await render();
  await click("جزئیات");
  const dialog = host.querySelector("dialog[open]");
  expect(dialog?.textContent).toContain("BACKUP_FAILED");
  expect(dialog?.textContent).not.toContain(job.backupKey);
});
it.each(["QUEUED", "RUNNING", "VERIFYING"] as const)(
  "polls %s at 7.5 seconds and stops when terminal",
  async (state) => {
    jobs = [{ ...job, state }];
    await render();
    const count = fetchMock.mock.calls.filter((call) =>
      call[0].includes("?limit="),
    ).length;
    await tick(7000);
    expect(
      fetchMock.mock.calls.filter((call) => call[0].includes("?limit=")),
    ).toHaveLength(count);
    jobs = [job];
    await tick(500);
    expect(
      fetchMock.mock.calls.filter((call) => call[0].includes("?limit=")),
    ).toHaveLength(count + 1);
    await tick(30000);
    expect(
      fetchMock.mock.calls.filter((call) => call[0].includes("?limit=")),
    ).toHaveLength(count + 1);
  },
);
it.each([
  ["QUEUED", "در انتظار شروع سرویس بکاپ", true],
  ["RUNNING", "در حال تهیه نسخه پشتیبان...", true],
  ["VERIFYING", "در حال بررسی فایل‌ها و صحت Checksum...", true],
  ["SUCCEEDED", "بکاپ با موفقیت تکمیل شد.", false],
  ["FAILED", "اجرای بکاپ ناموفق بود.", false],
  ["PRUNED", "حذف شده", false],
] as const)(
  "renders explicit %s status without fake progress",
  async (state, text, spinner) => {
    jobs = [{ ...job, state, createdAt: new Date().toISOString() }];
    await render();
    const card = host.querySelector(".backup-job");
    expect(card?.textContent).toContain(text);
    expect(Boolean(card?.querySelector(".backup-spinner"))).toBe(spinner);
    expect(card?.querySelector("[role=progressbar]")).toBeNull();
    expect(card?.textContent).not.toMatch(/[%٪]/);
    expect(card?.textContent).not.toContain("این درخواست هنوز");
    if (state === "SUCCEEDED") {
      expect(card?.textContent).toContain("تأیید شده");
      expect(card?.textContent).toContain("مگابایت");
    }
  },
);
it("warns only after queued age exceeds two minutes without changing its state", async () => {
  jobs = [
    {
      ...job,
      state: "QUEUED",
      createdAt: new Date(Date.now() - 119_000).toISOString(),
    },
  ];
  await render();
  expect(host.textContent).not.toContain("این درخواست هنوز");
  await tick(7500);
  expect(host.textContent).toContain(
    "این درخواست هنوز توسط سرویس اجرای بکاپ دریافت نشده است.",
  );
  expect(host.textContent).toContain("حداکثر هر ۱۵ دقیقه");
  expect(host.querySelector(".backup-job-delayed")).not.toBeNull();
  expect(jobs[0]?.state).toBe("QUEUED");
});
it("pauses active polling while hidden and resumes when visible", async () => {
  jobs = [{ ...job, state: "RUNNING" }];
  await render();
  const calls = () =>
    fetchMock.mock.calls.filter((call) => call[0].includes("?limit=")).length;
  const initial = calls();
  await act(async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tick(30000);
  expect(calls()).toBe(initial);
  await act(async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tick(7500);
  expect(calls()).toBe(initial + 1);
});
it.each(["SUCCEEDED", "FAILED", "PRUNED"] as const)(
  "does not poll %s history and supports manual refresh",
  async (state) => {
    jobs = [{ ...job, state }];
    await render();
    await tick(30000);
    expect(
      fetchMock.mock.calls.filter((call) => call[0].includes("?limit=")),
    ).toHaveLength(1);
    await click("تازه‌سازی وضعیت");
    expect(
      fetchMock.mock.calls.filter((call) => call[0].includes("?limit=")),
    ).toHaveLength(2);
  },
);
it("reports generic API failures without leaking backend response data", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: "secret-stack" } }),
  });
  await render();
  expect(host.textContent).toContain("دوباره تلاش کنید");
  expect(host.textContent).not.toContain("secret-stack");
});
it("announces history loading until the initial response completes", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(createElement(BackupCenter)));
  expect(host.querySelector("[role=status]")?.textContent).toContain(
    "هنوز دریافت نشده",
  );
  expect(host.textContent).toContain("در حال دریافت تاریخچه");
  expect(host.querySelector("[aria-busy=true]")).not.toBeNull();
});
it("does not report queued delivery when the manual request fails", async () => {
  await render();
  await click("تهیه بکاپ کامل");
  fetchMock.mockResolvedValueOnce({ ok: false });
  await click("ثبت درخواست بکاپ");
  expect(host.textContent).toContain("ثبت درخواست بکاپ ممکن نشد");
  expect(host.textContent).not.toContain("درخواست بکاپ ثبت شد و در صف");
  expect(host.querySelector("dialog[open]")).not.toBeNull();
});
it("keeps existing settings and reports a generic policy save failure", async () => {
  await render();
  fetchMock.mockResolvedValueOnce({ ok: false });
  await submit();
  expect(host.textContent).toContain("ذخیره تنظیمات ممکن نشد");
  expect(host.textContent).not.toContain("تنظیمات ذخیره شد");
  expect(
    (host.querySelector("#backup-retention") as HTMLInputElement).value,
  ).toBe("7");
});
it("paginates with bounded limit and offset", async () => {
  jobs = Array.from({ length: 25 }, (_, index) => ({
    ...job,
    id: String(index),
  }));
  await render();
  await click("صفحه بعد");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/platform/backups?limit=25&offset=25",
    expect.anything(),
  );
});
it("requires destructive confirmation and queues deletion without removing history", async () => {
  jobs = [{ ...job, canDelete: true }];
  await render();
  await click("حذف نسخه");
  expect(mutations("POST")).toHaveLength(0);
  expect(host.querySelector("dialog[open]")?.textContent).toContain(
    "اطلاعات سابقه برای گزارش‌گیری باقی می‌ماند.",
  );
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: { ...job, canDelete: false, deleteRequest: { state: "QUEUED" } },
    }),
  });
  await click("درخواست حذف");
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/platform/backups/${job.id}/delete`,
    expect.objectContaining({ method: "POST", body: "{}" }),
  );
  expect(host.textContent).toContain("در صف حذف");
  expect(host.querySelectorAll(".backup-job")).toHaveLength(1);
  expect(host.textContent).not.toContain("حذف با موفقیت");
});
it.each(["QUEUED", "RUNNING", "VERIFYING", "FAILED", "PRUNED"] as const)(
  "does not offer deletion for %s",
  async (state) => {
    jobs = [{ ...job, state, canDelete: true }];
    await render();
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (b) => b.textContent === "حذف نسخه",
      ),
    ).toBe(false);
  },
);
it.each([
  ["QUEUED", "در صف حذف"],
  ["RUNNING", "در حال حذف"],
  ["FAILED", "حذف ناموفق بود"],
] as const)("renders %s deletion status", async (state, text) => {
  jobs = [{ ...job, deleteRequest: { state } }];
  await render();
  expect(host.textContent).toContain(text);
});
it.each(["QUEUED", "RUNNING"] as const)(
  "polls active %s deletion and stops after completion",
  async (state) => {
    jobs = [{ ...job, deleteRequest: { state } }];
    await render();
    const requests = () =>
      fetchMock.mock.calls.filter((call) => call[0].includes("?limit="));
    const count = requests().length;
    await tick(7000);
    expect(requests()).toHaveLength(count);
    jobs = [{ ...job, state: "PRUNED" }];
    await tick(500);
    expect(requests()).toHaveLength(count + 1);
    await tick(30000);
    expect(requests()).toHaveLength(count + 1);
    expect(host.textContent).toContain("حذف شده");
  },
);
it("disables the backend-protected last backup without counting paginated rows", async () => {
  jobs = [{ ...job, canDelete: false, deleteProtected: true }];
  await render();
  expect(button("حذف نسخه").disabled).toBe(true);
  expect(host.textContent).toContain(
    "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
  );
});
it("shows only reviewed last-backup error or a generic deletion error", async () => {
  jobs = [{ ...job, canDelete: true }];
  await render();
  await click("حذف نسخه");
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({
      error: {
        code: "CONFLICT",
        message: "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
      },
    }),
  });
  await click("درخواست حذف");
  expect(host.textContent).toContain(
    "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
  );
  expect(host.querySelector("dialog[open]")?.textContent).toContain(
    "حداقل یک نسخه پشتیبان موفق باید باقی بماند.",
  );
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: { message: "secret-host-path-stack" } }),
  });
  await click("درخواست حذف");
  expect(host.textContent).not.toContain("secret-host-path-stack");
  expect(host.textContent).toContain("ثبت درخواست حذف ممکن نشد");
  expect(host.querySelector("input[name=path]")).toBeNull();
  expect(
    Array.from(host.querySelectorAll("button")).some((b) =>
      /بازیابی|دانلود/.test(b.textContent ?? ""),
    ),
  ).toBe(false);
});
