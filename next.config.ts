import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: [
    "@node-rs/argon2",
    "better-auth",
    "pg",
    "pg-boss",
    "pino",
    "nodemailer",
  ],
};

export default nextConfig;
