import "server-only";
import { z } from "zod";
import type { LocalMediaStorage } from "@/infrastructure/media/local";

export async function tenantArchiveKeys(
  storage: LocalMediaStorage,
  tenantId: string,
) {
  const id = z.uuid().parse(tenantId).toLowerCase();
  return (await storage.listKeys()).filter((key) =>
    key.startsWith(`tenants/${id}/`),
  );
}
