import { expect, it } from "vitest";
import { cleanResponse } from "@/modules/tenant-identity/auth-response";

it("preserves normal response bytes, status and session cookies", async () => {
  const response = new Response('{"success":true}', {
    status: 201,
    headers: {
      "set-cookie": "session=synthetic; HttpOnly",
      "content-type": "application/json",
    },
  });
  const cleaned = await cleanResponse(response, "/sign-up/email");
  expect(cleaned.status).toBe(201);
  expect(cleaned.headers.get("set-cookie")).toBe("session=synthetic; HttpOnly");
  expect(await cleaned.text()).toBe('{"success":true}');
});

it("rejects a consumed body instead of fabricating a successful empty response", async () => {
  const response = new Response("original");
  await response.text();
  await expect(cleanResponse(response, "/sign-up/email")).rejects.toThrow();
});

it("rejects a locked body instead of fabricating success", async () => {
  const response = new Response("original");
  const reader = response.body!.getReader();
  try {
    await expect(cleanResponse(response, "/sign-up/email")).rejects.toThrow();
  } finally {
    reader.releaseLock();
  }
});

it("keeps sensitive sign-in fields out while retaining the session cookie", async () => {
  const response = new Response(
    JSON.stringify({
      user: {
        id: "u",
        name: "User",
        email: "u@example.test",
        password: "private",
        lockedUntil: "private",
      },
      token: "private",
    }),
    { headers: { "set-cookie": "session=synthetic; HttpOnly" } },
  );
  const cleaned = await cleanResponse(response, "/sign-in/email");
  expect(cleaned.headers.get("set-cookie")).toContain("session=synthetic");
  expect(await cleaned.json()).toEqual({
    user: { id: "u", name: "User", email: "u@example.test", image: null },
    redirect: false,
  });
});
