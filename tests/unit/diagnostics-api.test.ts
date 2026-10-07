import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/shared/errors/domain-error";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  summary: vi.fn(),
  incidents: vi.fn(),
  events: vi.fn(),
  detail: vi.fn(),
  export: vi.fn(),
}));
vi.mock("@/infrastructure/auth/platform-session", () => ({
  requirePlatformAdmin: mocks.auth,
}));
vi.mock("@/modules/platform/diagnostics/repository", () => ({
  DiagnosticsRepository: class {
    getDiagnosticsSummary = mocks.summary;
    listIncidents = mocks.incidents;
    listDiagnosticEvents = mocks.events;
    getIncident = mocks.detail;
    exportIncident = mocks.export;
  },
}));

import { GET as events } from "@/app/api/platform/diagnostics/events/route";
import { GET as download } from "@/app/api/platform/diagnostics/incidents/[incidentId]/export/route";
import { GET as detail } from "@/app/api/platform/diagnostics/incidents/[incidentId]/route";
import { GET as incidents } from "@/app/api/platform/diagnostics/incidents/route";
import { GET as summary } from "@/app/api/platform/diagnostics/summary/route";

const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ incidentId: id }) };
const request = (path: string) =>
  new Request(`http://localhost/api/platform/diagnostics/${path}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ adminId: id });
  mocks.summary.mockResolvedValue({ components: [] });
  mocks.incidents.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
  mocks.detail.mockResolvedValue({ id, summary: "Safe" });
  mocks.export.mockResolvedValue({
    incident: {
      incidentRef: "INC-20261007-11111111111141118111111111111111",
      troubleshooting: ["Safe"],
    },
    events: [],
  });
});
it.each(["summary", "incidents", "events", "detail", "export"])(
  "%s requires Platform Admin",
  async (name) => {
    mocks.auth.mockRejectedValue(
      new DomainError("UNAUTHENTICATED", "Sign-in required"),
    );
    const response =
      name === "summary"
        ? await summary(request(name))
        : name === "incidents"
          ? await incidents(request(name))
          : name === "events"
            ? await events(request(name))
            : name === "detail"
              ? await detail(request(name), context)
              : await download(request(name), context);
    expect(response.status).toBe(401);
    for (const mock of [
      mocks.summary,
      mocks.incidents,
      mocks.events,
      mocks.detail,
      mocks.export,
    ])
      expect(mock).not.toHaveBeenCalled();
  },
);
it.each([
  "limit=101",
  "limit=0",
  "offset=10001",
  "component=../raw",
  "severity=HIGH",
  "status=CLOSED",
  "tenantId=invalid",
  "requestId=secret",
  "rawSql=select",
])("rejects invalid incident filter %s", async (query) => {
  expect((await incidents(request(`incidents?${query}`))).status).toBe(400);
  expect(mocks.incidents).not.toHaveBeenCalled();
});
it("passes only validated bounded filters", async () => {
  const response = await incidents(
    request(
      `incidents?status=OPEN&severity=ERROR&component=BACKUP_SYSTEM&tenantId=${id}&requestId=${id}&limit=10&offset=20`,
    ),
  );
  expect(response.status).toBe(200);
  expect(mocks.incidents).toHaveBeenCalledWith({
    status: "OPEN",
    severity: "ERROR",
    component: "BACKUP_SYSTEM",
    tenantId: id,
    requestId: id,
    limit: 10,
    offset: 20,
  });
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("validates event filters and safely serializes their DTO", async () => {
  expect((await events(request("events?incidentId=bad"))).status).toBe(400);
  const response = await events(request(`events?incidentId=${id}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [] });
  expect(mocks.events).toHaveBeenCalledWith({
    incidentId: id,
    limit: 25,
    offset: 0,
  });
});
it("unknown incident returns safe 404; invalid UUID never queries", async () => {
  mocks.detail.mockRejectedValue(
    new DomainError("NOT_FOUND", "Incident not found."),
  );
  expect((await detail(request(`incidents/${id}`), context)).status).toBe(404);
  vi.clearAllMocks();
  expect(
    (
      await detail(request("incidents/bad"), {
        params: Promise.resolve({ incidentId: "bad" }),
      })
    ).status,
  ).toBe(400);
  expect(mocks.detail).not.toHaveBeenCalled();
});
it("exports one safe JSON incident with static hints and bounded safe filename", async () => {
  const response = await download(request(`incidents/${id}/export`), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toMatch(
    /^attachment; filename="eventos-incident-INC-/,
  );
  expect((await response.json()).data.incident.troubleshooting).toEqual([
    "Safe",
  ]);
  expect(mocks.export).toHaveBeenCalledWith(id);
});
it("export errors never expose exception messages or stack", async () => {
  mocks.export.mockRejectedValue(new Error("SMTP_URL=password-secret"));
  const response = await download(request("export"), context);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toMatch(/SMTP_URL|password-secret|stack/);
});
it("summary uses the repository without writing on HTTP success", async () => {
  expect((await summary(request("summary"))).status).toBe(200);
  expect(mocks.summary).toHaveBeenCalledOnce();
  expect(mocks.incidents).not.toHaveBeenCalled();
});
