import "server-only";
import { getServerConfig } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
export function assertPlatformActivationHost(headers: Headers) {
  if (
    headers.get("host")?.toLowerCase() !==
    new URL(getServerConfig().BETTER_AUTH_URL).host.toLowerCase()
  )
    throw new DomainError(
      "NOT_FOUND",
      "این صفحه فقط روی دامنه مدیریت پلتفرم در دسترس است.",
    );
}
