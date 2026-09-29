import { getServerConfig } from "./src/shared/config/env";

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    getServerConfig();
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeShutdownHandlers } = await import(
      "./instrumentation.node"
    );
    registerNodeShutdownHandlers();
  }
}
