"use client";

import { useState } from "react";
import type { MediaKind } from "@/modules/media/validation";

export function MediaUploader({
  kind,
  programId,
  resourceId,
  label,
  value,
  onChange,
}: {
  kind: MediaKind;
  programId?: string;
  resourceId?: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const isVideo = kind === "PROGRAM_VIDEO";
  const isPdf = kind === "INSTRUCTOR_RESUME";
  const accept = isVideo
    ? "video/mp4"
    : isPdf
      ? "application/pdf"
      : kind === "WEBSITE_FAVICON"
        ? "image/png,image/webp"
        : "image/jpeg,image/png,image/webp";
  const path = `/api/tenant/media?${new URLSearchParams({ kind, ...(programId ? { programId } : {}), ...(resourceId ? { resourceId } : {}) })}`;
  function upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    const xhr = new XMLHttpRequest();
    setError("");
    setProgress(0);
    xhr.open("POST", path);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setProgress(Math.round((event.loaded * 100) / event.total));
    };
    xhr.onload = () => {
      setProgress(null);
      const response = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300 && response.data?.url)
        onChange(response.data.url);
      else setError(response.error?.message ?? "بارگذاری رسانه انجام نشد.");
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("ارتباط برای بارگذاری رسانه برقرار نشد.");
    };
    xhr.send(form);
  }
  async function remove() {
    setError("");
    const response = await fetch(path, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error?.message ?? "حذف رسانه انجام نشد.");
      return;
    }
    onChange("");
  }
  return (
    <div className="media-uploader">
      <strong>{label}</strong>
      {value &&
        (isPdf ? (
          <a href={value}>رزومهٔ بارگذاری‌شده (PDF)</a>
        ) : isVideo ? (
          // biome-ignore lint/a11y/useMediaCaption: Uploaded media has no caption asset in this product version.
          <video controls preload="metadata" src={value} />
        ) : (
          <img src={value} alt={label} />
        ))}
      <label className="btn btn-secondary btn-small">
        {value ? "جایگزینی" : "بارگذاری"}
        <input
          type="file"
          accept={accept}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {value && (
        <button
          className="btn btn-danger btn-small"
          type="button"
          onClick={() => void remove()}
        >
          حذف
        </button>
      )}
      {progress !== null && (
        <progress value={progress} max={100} aria-label="پیشرفت بارگذاری" />
      )}
      {error && (
        <span className="alert alert-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
