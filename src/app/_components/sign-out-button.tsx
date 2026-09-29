"use client";

import { createAuthClient } from "better-auth/react";
import { useState } from "react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await createAuthClient().signOut();
      window.location.assign("/sign-in");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="signout" onClick={signOut} disabled={busy}>
      خروج امن
    </button>
  );
}
