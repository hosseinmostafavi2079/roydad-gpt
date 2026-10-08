import { jsonResponse } from "@/shared/http/api-response";

export async function cleanResponse(
  response: Response,
  path: string,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.delete("content-length");
  if (response.status >= 400) {
    const message =
      response.status === 429
        ? "Sign-in is temporarily unavailable. Try again later."
        : "Email or password is incorrect.";
    return new Response(
      JSON.stringify({ message, code: "AUTHENTICATION_FAILED" }),
      { status: response.status, headers },
    );
  }
  if (path === "/get-session") {
    const body = await response.json();
    const user = body?.user ?? body?.data?.user;
    if (
      typeof user?.email === "string" &&
      user.email.endsWith("@phone.eventos.invalid")
    )
      user.email = "";
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers,
    });
  }
  if (
    path !== "/sign-in/email" &&
    path !== "/sign-in/email-otp" &&
    path !== "/sign-in/social"
  )
    return new Response(
      response.body === null ? null : await response.arrayBuffer(),
      {
        status: response.status,
        headers,
      },
    );
  try {
    const body: unknown = await response.json();
    const value = body as {
      data?: { user?: Record<string, unknown> };
      user?: Record<string, unknown>;
      [key: string]: unknown;
    };
    const user = value?.data?.user ?? value?.user;
    const safeUser = user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image ?? null,
        }
      : undefined;
    const social = path === "/sign-in/social";
    const redirectUrl =
      social &&
      value?.redirect === true &&
      typeof value.url === "string" &&
      value.url.startsWith("https://accounts.google.com/")
        ? value.url
        : undefined;
    return jsonResponse(
      social
        ? {
            ...(safeUser ? { user: safeUser } : {}),
            redirect: Boolean(redirectUrl),
            ...(redirectUrl ? { url: redirectUrl } : {}),
          }
        : { ...(safeUser ? { user: safeUser } : {}), redirect: false },
      { status: response.status, headers },
    );
  } catch {
    return jsonResponse(
      { message: "Sign-in could not be completed." },
      { status: 502, headers },
    );
  }
}
