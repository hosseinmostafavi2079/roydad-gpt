import pino from "pino";

const sensitivePaths = [
  "password",
  "**.password",
  "token",
  "**.token",
  "**.secret",
  "**.backupCodes",
  "**.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "**.cookie",
  "**.connectionString",
  "**.databaseUrl",
  "**.smtpUrl",
  "**.apiKey",
  "**.resetToken",
  "**.otp",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: sensitivePaths, censor: "[REDACTED]" },
  base: { service: "eventos-platform" },
  serializers: {
    err: pino.stdSerializers.err,
    req: (request: { method?: string; url?: string; id?: string }) => ({
      method: request.method,
      url: request.url?.split("?")[0],
      id: request.id,
    }),
  },
});

export function requestLogger(requestId: string) {
  return logger.child({ requestId });
}
