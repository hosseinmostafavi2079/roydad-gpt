"use client";
import { useState } from "react";
import { apiRequest, errorMessage } from "./api-client";
export function OwnerBootstrapAccess({
  tenantId,
  available,
  siteUrl,
}: {
  tenantId: string;
  available: boolean;
  siteUrl: string;
}) {
  const [access, setAccess] = useState<{
    username: string;
    activationCode: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  if (!available && !access) return null;
  return (
    <section className="card card-pad section" aria-label="راه‌اندازی مدیر اصلی">
      <h2 className="card-title">مدیر اصلی ایجاد شد</h2>
      <p>
        کد راه‌اندازی فقط یک‌بار قابل دریافت است. آن را از مسیر امن به مدیر اصلی
        تحویل دهید. پس از خروج از این صفحه دوباره نمایش داده نمی‌شود.
      </p>
      {access ? (
        <>
          <p>
            نام کاربری: <b dir="ltr">{access.username}</b>
          </p>
          <label className="label" htmlFor="owner-activation-code">
            کد راه‌اندازی
          </label>
          <input
            id="owner-activation-code"
            className="input"
            dir="ltr"
            readOnly
            type={show ? "text" : "password"}
            value={access.activationCode}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShow(!show)}
          >
            {show ? "پنهان کردن" : "نمایش"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(access.activationCode);
                setMessage("کد کپی شد.");
              } catch {
                setMessage("کپی انجام نشد؛ کد را به صورت دستی منتقل کنید.");
              }
            }}
          >
            کپی کد
          </button>
          <p>اعتبار تا: {new Date(access.expiresAt).toLocaleString("fa-IR")}</p>
          <a className="link" href={`${siteUrl}/owner-setup`}>
            صفحه تعیین گذرواژه مدیر اصلی
          </a>
          <p>
            این کد گذرواژه ورود نیست؛ مدیر اصلی باید ابتدا گذرواژه شخصی خود را
            تعیین کند. موبایل هنوز تأیید نشده است.
          </p>
        </>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                "کد فقط همین بار نمایش داده می‌شود. آماده تحویل امن هستید؟",
              )
            )
              return;
            setBusy(true);
            try {
              setAccess(
                await apiRequest(
                  `/api/platform/tenants/${tenantId}/owner-bootstrap`,
                  { method: "POST", body: {} },
                ),
              );
            } catch (error) {
              setMessage(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          دریافت یک‌باره کد راه‌اندازی
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
