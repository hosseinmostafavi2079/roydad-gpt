import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/tenant/schema.prisma",
  migrations: { path: "prisma/tenant/migrations" },
  datasource: {
    url: process.env.TENANT_PRISMA_DATABASE_URL ?? "",
  },
});
