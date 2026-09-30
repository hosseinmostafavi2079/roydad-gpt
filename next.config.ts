import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/tenant/certificates": [
      "./node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff",
    ],
  },
  serverExternalPackages: [
    "@node-rs/argon2",
    "better-auth",
    "pg",
    "pg-boss",
    "pino",
    "nodemailer",
    "pdfkit",
  ],
};

export default nextConfig;
