"use client";

import { useEffect, useState } from "react";

export function QrCheckIn() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get("token") ?? "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  async function checkIn() {
    const response = await fetch("/api/tenant/attendance/check-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await response.json();
    setMessage(
      response.ok
        ? "حضور شما ثبت شد."
        : (body.error?.message ?? "ثبت حضور ناموفق بود."),
    );
    setToken("");
  }
  return (
    <section className="public-section">
      <h1>ثبت حضور</h1>
      <p>کد QR جلسه را با حساب شرکت‌کننده باز کنید.</p>
      <button type="button" disabled={!token} onClick={checkIn}>
        تأیید حضور
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
