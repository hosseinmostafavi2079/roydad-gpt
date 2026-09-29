let shutdownStarted = false;

const closePlatformResources = async (
  signal: "SIGINT" | "SIGTERM",
): Promise<void> => {
  if (shutdownStarted) return;
  shutdownStarted = true;

  const { logger } = await import("./src/infrastructure/logging/logger");
  logger.info({ signal }, "Stopping platform database resources");

  const resourceNames = [
    "provisioning_queue",
    "tenant_database_pools",
    "control_database_pool",
  ] as const;
  const operations = [
    () =>
      import("./src/modules/platform/provisioning/queue").then((module) =>
        module.stopProvisioningBoss(),
      ),
    () =>
      import("./src/infrastructure/db/tenant/pool").then((module) =>
        module.closeTenantPools(),
      ),
    () =>
      import("./src/infrastructure/db/control/pool").then((module) =>
        module.closeControlPool(),
      ),
  ];
  const results = await Promise.all(
    operations.map(async (operation, index) => {
      try {
        await operation();
        logger.info(
          { signal, resource: resourceNames[index] },
          "Platform database resource closed",
        );
        return { status: "fulfilled" as const };
      } catch (reason) {
        return { status: "rejected" as const, reason };
      }
    }),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            resource: resourceNames[index],
            errorType:
              result.reason instanceof Error
                ? result.reason.name
                : typeof result.reason,
          },
        ]
      : [],
  );
  if (failures.length) {
    logger.error(
      { signal, failures },
      "Some platform database resources did not close cleanly",
    );
  } else {
    logger.info({ signal }, "Platform database resources closed");
  }

  process.exit(failures.length ? 1 : 0);
};

export function registerNodeShutdownHandlers(): void {
  process.once("SIGINT", () => {
    void closePlatformResources("SIGINT");
  });
  process.once("SIGTERM", () => {
    void closePlatformResources("SIGTERM");
  });
}
