import { beforeEach, expect, it, vi } from "vitest";
import { DomainError } from "@/shared/errors/domain-error";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  failure: vi.fn(),
  recovery: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  expire: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("@/infrastructure/db/control/pool", () => ({
  getControlPool: () => ({
    query: mocks.query,
    connect: async () => ({ query: mocks.query, release: mocks.release }),
  }),
}));
vi.mock("@/infrastructure/logging/logger", () => ({
  logger: { warn: mocks.warn, info: mocks.info },
}));
vi.mock("@/modules/platform/diagnostics/service", () => ({
  recordOperationalFailure: mocks.failure,
  recordOperationalRecovery: mocks.recovery,
}));
vi.mock("@/modules/payments/lifecycle", () => ({
  expirePaymentReservations: mocks.expire,
}));
vi.mock("@/modules/payments/service", () => ({
  reconcileUnresolvedPayments: mocks.reconcile,
}));

import { GET as ready } from "@/app/api/health/ready/route";
import { runPaymentMaintenanceCycle } from "@/modules/payments/maintenance";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.failure.mockResolvedValue(undefined);
  mocks.recovery.mockResolvedValue(undefined);
});
it("readiness failure remains 503 and Pino fallback, with no recursive outage writes", async () => {
  mocks.query.mockRejectedValue(new Error("secret connection"));
  const response = await ready();
  expect(response.status).toBe(503);
  expect(mocks.query).toHaveBeenCalledOnce();
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(mocks.warn).toHaveBeenCalledWith(
    { error: "Error", eventCode: "CONTROL_DB_UNAVAILABLE" },
    "Readiness check failed",
  );
  expect(await response.text()).not.toContain("secret");
});
it("successful readiness does not persist a heartbeat or event", async () => {
  expect((await ready()).status).toBe(200);
  expect(mocks.query).toHaveBeenCalledExactlyOnceWith("SELECT 1");
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(mocks.recovery).not.toHaveBeenCalled();
});
const tenantId = "11111111-1111-4111-8111-111111111111";
function paymentFixture(error: unknown) {
  mocks.query
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ tenant_id: tenantId, database_name: "private-database" }],
    });
  mocks.expire.mockRejectedValue(error);
}
it("payment central boundary records only safe operational data", async () => {
  paymentFixture(new Error("password secret SQL"));
  const result = await runPaymentMaintenanceCycle();
  expect(result.failures).toBe(1);
  expect(mocks.failure).toHaveBeenCalledWith({
    code: "PAYMENT_RECONCILIATION_FAILED",
    tenantId,
    requestId: expect.any(String),
  });
  expect(JSON.stringify(mocks.failure.mock.calls)).not.toMatch(
    /password|private-database|SQL/,
  );
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("expected business errors do not generate payment incidents", async () => {
  paymentFixture(new DomainError("VALIDATION_FAILED", "Invalid input"));
  expect((await runPaymentMaintenanceCycle()).failures).toBe(1);
  expect(mocks.failure).not.toHaveBeenCalled();
});
it("successful payment maintenance recovers only the matching tenant incident", async () => {
  mocks.query
    .mockResolvedValueOnce({ rows: [{ locked: true }] })
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ tenant_id: tenantId, database_name: "private-database" }],
    });
  mocks.expire.mockResolvedValue({ expired: 0 });
  mocks.reconcile.mockResolvedValue({ updated: 0, failed: 0 });
  expect((await runPaymentMaintenanceCycle()).failures).toBe(0);
  expect(mocks.recovery).toHaveBeenCalledWith({
    code: "PAYMENT_RECONCILIATION_FAILED",
    tenantId,
    requestId: expect.any(String),
  });
  expect(mocks.failure).not.toHaveBeenCalled();
});
