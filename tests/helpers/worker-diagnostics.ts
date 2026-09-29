const secretNames = [
  "CONTROL_APP_PASSWORD",
  "CONTROL_MIGRATION_PASSWORD",
  "CONTROL_QUEUE_PASSWORD",
  "TENANT_PROVISIONER_PASSWORD",
  "TENANT_RUNTIME_PASSWORD",
  "TENANT_MIGRATION_PASSWORD",
  "BETTER_AUTH_SECRET",
  "TENANT_BOOTSTRAP_ENCRYPTION_KEY",
];

export function workerDiagnostics(stdout: string, stderr: string): string {
  let output = `stderr: ${stderr.slice(-4000) || "(empty)"}; stdout: ${stdout.slice(-2000) || "(empty)"}`;
  output = output.replace(
    /\b(postgres(?:ql)?:\/\/)[^\s"'@]+@/gi,
    "$1[REDACTED]@",
  );
  for (const name of secretNames) {
    const value = process.env[name];
    if (value) output = output.replaceAll(value, "[REDACTED]");
  }
  return output;
}
