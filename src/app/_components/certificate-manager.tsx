"use client";

import { useState } from "react";

type Certificate = {
  id: string;
  serial_number: string;
  participant_name: string;
  program_name: string;
  status: string;
  issued_at: Date;
};
type Template = {
  id: string;
  name: string;
  fields_config: {
    message: string;
    showOrganizationLogo: boolean;
    accentColor: string;
  };
  background_object_key: string | null;
};
type Candidate = {
  run_id: string;
  run_title: string;
  participant_id: string;
  participant_name: string;
};
export function CertificateManager({
  certificates,
  templates,
  candidates,
  canManageTemplates,
  canIssue,
  canRevoke,
}: {
  certificates: Certificate[];
  templates: Template[];
  candidates: Candidate[];
  canManageTemplates: boolean;
  canIssue: boolean;
  canRevoke: boolean;
}) {
  const [items, setItems] = useState(certificates);
  const [designs, setDesigns] = useState(templates);
  const [name, setName] = useState("");
  const [message, setMessage] = useState(
    "گواهی می‌شود {{participantName}} در برنامه {{programName}} شرکت کرده است.",
  );
  const [showLogo, setShowLogo] = useState(true);
  const [accentColor, setAccentColor] = useState("#174b57");
  const [selectedTemplate, setSelectedTemplate] = useState(
    templates[0]?.id ?? "",
  );
  const [candidate, setCandidate] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(path: string, method: string, payload?: unknown) {
    const response = await fetch(path, {
      method,
      ...(payload
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        : {}),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message ?? "عملیات ناموفق بود.");
    return body.data;
  }
  async function create() {
    try {
      const result = await submit("/api/tenant/certificate-templates", "POST", {
        name,
        fields: { message, showOrganizationLogo: showLogo, accentColor },
      });
      setDesigns([
        ...designs,
        {
          id: result.id,
          name,
          fields_config: {
            message,
            showOrganizationLogo: showLogo,
            accentColor,
          },
          background_object_key: null,
        },
      ]);
      setSelectedTemplate(result.id);
      setName("");
      setNotice("قالب ساخته شد.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "خطا");
    }
  }
  async function issue() {
    const option = candidates[Number(candidate)];
    if (!option || !selectedTemplate) return;
    try {
      await submit("/api/tenant/certificates", "POST", {
        runId: option.run_id,
        participantId: option.participant_id,
        templateId: selectedTemplate,
      });
      const response = await fetch("/api/tenant/certificates");
      const body = await response.json();
      if (response.ok) setItems(body.data);
      setNotice("گواهی صادر شد.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "خطا");
    }
  }
  async function revoke(id: string) {
    try {
      await submit(`/api/tenant/certificates/${id}/revoke`, "POST");
      setItems(
        items.map((item) =>
          item.id === id ? { ...item, status: "REVOKED" } : item,
        ),
      );
      setNotice("گواهی لغو شد.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "خطا");
    }
  }
  async function upload(templateId: string, file: File) {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(
      `/api/tenant/certificate-templates/${templateId}/background`,
      { method: "POST", body },
    );
    const result = await response.json();
    setNotice(
      response.ok
        ? "پس‌زمینه ذخیره شد."
        : (result.error?.message ?? "بارگذاری ناموفق بود."),
    );
  }
  return (
    <main className="page-content" dir="rtl">
      <div className="page-heading">
        <div>
          <h1>گواهی‌ها</h1>
          <p>قالب، صدور و اعتبارسنجی گواهی</p>
        </div>
      </div>
      {canManageTemplates ? (
        <section className="panel">
          <h2>قالب‌ها</h2>
          <label>
            نام قالب
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            متن گواهی
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label>
            نمایش لوگوی مجموعه
            <input
              type="checkbox"
              checked={showLogo}
              onChange={(e) => setShowLogo(e.target.checked)}
            />
          </label>
          <label>
            رنگ اصلی گواهی
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
            />
          </label>
          <p>
            جایگزین‌ها: participantName، programName، instructorName، issuedAt
          </p>
          <button type="button" onClick={create}>
            ساخت قالب
          </button>
          <ul>
            {designs.map((design) => (
              <li key={design.id}>
                {design.name}{" "}
                <label>
                  تصویر پس‌زمینه PNG/JPEG
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(design.id, file);
                    }}
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {canIssue ? (
        <section className="panel">
          <h2>صدور گواهی</h2>
          <label>
            شرکت‌کننده و اجرا
            <select
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {candidates.map((entry, index) => (
                <option
                  key={`${entry.run_id}-${entry.participant_id}`}
                  value={index}
                >
                  {entry.participant_name} · {entry.run_title}
                </option>
              ))}
            </select>
          </label>
          <label>
            قالب
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {designs.map((design) => (
                <option key={design.id} value={design.id}>
                  {design.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={issue}
            disabled={!candidate || !selectedTemplate}
          >
            صدور
          </button>
        </section>
      ) : null}
      <section className="panel">
        <h2>گواهی‌های صادرشده</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>شماره</th>
                <th>شرکت‌کننده</th>
                <th>برنامه</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.serial_number}</td>
                  <td>{item.participant_name}</td>
                  <td>{item.program_name}</td>
                  <td>{item.status === "ACTIVE" ? "معتبر" : "لغوشده"}</td>
                  <td>
                    {item.status === "ACTIVE" ? (
                      <a href={`/api/tenant/certificates/${item.id}/pdf`}>
                        دریافت PDF
                      </a>
                    ) : null}
                    {canRevoke && item.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() => void revoke(item.id)}
                      >
                        لغو
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {notice ? <p role="status">{notice}</p> : null}
    </main>
  );
}
