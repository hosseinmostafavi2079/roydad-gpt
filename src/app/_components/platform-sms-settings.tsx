"use client";
import { useEffect, useState } from "react";
import { apiRequest, errorMessage } from "./api-client";
export function PlatformSmsSettings({ tenantId }: { tenantId: string }) {
  const [providers, setProviders] = useState<
    { key: string; allowed: boolean }[]
  >([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    apiRequest<{ key: string; allowed: boolean }[]>(
      `/api/platform/tenants/${tenantId}/sms-providers`,
    )
      .then(setProviders)
      .catch((error) => setMessage(errorMessage(error)));
  }, [tenantId]);
  return (
    <section className="card card-pad">
      <h2>ارائه‌دهندگان مجاز پیامک</h2>
      {providers.map((provider) => (
        <label className="check-row" key={provider.key}>
          <span>
            {provider.key === "KAVENEGAR" ? "کاوه‌نگار" : provider.key}
          </span>
          <input
            type="checkbox"
            checked={provider.allowed}
            onChange={async (event) => {
              const allowed = event.target.checked;
              try {
                await apiRequest(
                  `/api/platform/tenants/${tenantId}/sms-providers`,
                  {
                    method: "PATCH",
                    body: {
                      providerKey: provider.key,
                      allowed,
                    },
                  },
                );
                setProviders(
                  providers.map((entry) =>
                    entry.key === provider.key ? { ...entry, allowed } : entry,
                  ),
                );
                setMessage("ذخیره شد.");
              } catch (error) {
                setMessage(errorMessage(error));
              }
            }}
          />
        </label>
      ))}
      <p>قابلیت پیامک نیز باید در طرح سازمان فعال باشد.</p>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={async () => {
          try {
            await apiRequest(
              `/api/platform/tenants/${tenantId}/identity-recovery`,
              { method: "POST", body: {} },
            );
            setMessage("روش ورود ایمیل مدیر بازیابی شد.");
          } catch (error) {
            setMessage(errorMessage(error));
          }
        }}
      >
        بازیابی ورود مدیر سازمان
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
