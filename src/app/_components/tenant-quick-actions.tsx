"use client";

import { useEffect, useState } from "react";

export function TenantQuickActions({
  siteUrl,
  active,
}: {
  siteUrl: string;
  active: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    sessionStorage.removeItem("eventos-tenant-created-id");
    sessionStorage.removeItem("eventos-tenant-creation-key");
  }, []);
  return (
    <div className="form-actions">
      {active && (
        <>
          <a
            className="btn btn-primary btn-small"
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            باز کردن سایت
          </a>
          <a
            className="btn btn-secondary btn-small"
            href={`${siteUrl}/dashboard`}
            target="_blank"
            rel="noopener noreferrer"
          >
            باز کردن پنل مدیریت
          </a>
          <button
            className="btn btn-secondary btn-small"
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(siteUrl)
                .then(() => setCopied(true))
            }
          >
            {copied ? "کپی شد ✓" : "کپی آدرس سایت"}
          </button>
          <a className="btn btn-secondary btn-small" href="#owner-invitation">
            ارسال مجدد دعوت مدیر
          </a>
        </>
      )}
      <a className="btn btn-secondary btn-small" href="#tenant-settings">
        ویرایش امکانات
      </a>
      <a className="btn btn-secondary btn-small" href="#tenant-health">
        مشاهده سلامت
      </a>
    </div>
  );
}
