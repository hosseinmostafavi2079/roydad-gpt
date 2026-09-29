import { jsonResponse } from "@/shared/http/api-response";

export function GET(): Response {
  return jsonResponse({ data: { status: "ok" } });
}
