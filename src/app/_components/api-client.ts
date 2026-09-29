"use client";

export async function apiRequest<T>(
  path: string,
  input?: Readonly<{ method?: string; body?: unknown }>,
): Promise<T> {
  const init: RequestInit = {
    method: input?.method ?? (input?.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    cache: "no-store",
  };
  if (input?.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(input.body);
  }
  const response = await fetch(path, init);
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.data) {
    throw new Error(
      payload?.error?.message || "درخواست انجام نشد. دوباره تلاش کنید.",
    );
  }
  return payload.data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "خطایی رخ داد. دوباره تلاش کنید.";
}
