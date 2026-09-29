"use client";

export function TenantSignOutButton() {
  async function signOut() {
    await fetch("/api/tenant-auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    window.location.assign("/login");
  }
  return (
    <button className="signout" type="button" onClick={signOut}>
      خروج امن
    </button>
  );
}
