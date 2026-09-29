"use client";

import { useState, type FormEvent } from "react";
import type { RegistrationForm } from "@/modules/enrollment/form";

export function PublicEnrollmentForm({
  runId,
  form,
}: {
  runId: string;
  form: RegistrationForm;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setResult("");
    const data = new FormData(event.currentTarget);
    const answers: Record<string, string | number | boolean> = {};
    for (const field of form.fields) {
      if (field.type === "checkbox") answers[field.key] = data.has(field.key);
      else if (field.type === "number") {
        const raw = String(data.get(field.key) ?? "");
        if (raw) answers[field.key] = Number(raw);
      } else {
        const raw = String(data.get(field.key) ?? "");
        if (raw) answers[field.key] = raw;
      }
    }
    try {
      const response = await fetch("/api/tenant/enrollments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, answers }),
      });
      if (response.status === 401) {
        window.location.assign(
          `/login?participant=1&next=${encodeURIComponent(`/events/${runId}`)}`,
        );
        return;
      }
      const payload = (await response.json()) as {
        data?: { status: string };
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message || "ثبت‌نام انجام نشد.");
      setResult(
        payload.data?.status === "WAITLISTED"
          ? "در فهرست انتظار قرار گرفتید."
          : "ثبت‌نام شما تأیید شد.",
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "ثبت‌نام انجام نشد.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="public-register-form" onSubmit={submit}>
      {form.fields.map((field) =>
        field.type === "radio" ? (
          <fieldset key={field.key}>
            <legend>
              {field.label}
              {field.required && " *"}
            </legend>
            {field.options.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name={field.key}
                  value={option}
                  required={field.required}
                />
                {option}
              </label>
            ))}
          </fieldset>
        ) : (
          <label key={field.key} htmlFor={`answer-${field.key}`}>
            {field.label}
            {field.required && " *"}
            {field.type === "textarea" ? (
              <textarea
                id={`answer-${field.key}`}
                name={field.key}
                required={field.required}
                maxLength={2000}
                rows={4}
              />
            ) : field.type === "select" ? (
              <select
                id={`answer-${field.key}`}
                name={field.key}
                required={field.required}
              >
                <option value="">انتخاب کنید</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`answer-${field.key}`}
                name={field.key}
                type={field.type === "phone" ? "tel" : field.type}
                required={field.required}
                maxLength={
                  field.type === "number" || field.type === "checkbox"
                    ? undefined
                    : 2000
                }
              />
            )}
          </label>
        ),
      )}
      <button type="submit" className="public-button" disabled={busy}>
        {busy ? "در حال بررسی…" : "ثبت‌نام در برنامه"}
      </button>
      <p role="status">{result}</p>
    </form>
  );
}
