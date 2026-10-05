"use client";

import { useState } from "react";
import type { InstructorContent } from "@/modules/public-site/instructors";
import { MediaUploader } from "./media-uploader";
import { apiRequest, errorMessage } from "./api-client";
import { AdminButton, StatusBadge } from "./admin-ui";

type EditorState = {
  id: string;
  slug: string;
  published: boolean;
  content: InstructorContent;
};
const lists = [
  ["certifications", "گواهی‌ها"],
  ["honors", "افتخارات"],
  ["books", "کتاب‌ها"],
  ["publications", "انتشارات"],
  ["projects", "پروژه‌ها"],
] as const;

function TagInput({
  label,
  values,
  onChange,
  max = 20,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const item = draft.trim();
    if (item && !values.includes(item) && values.length < max)
      onChange([...values, item]);
    setDraft("");
  }
  return (
    <div className="admin-tag-field">
      <label>
        {label}
        <input
          aria-label={label}
          value={draft}
          maxLength={160}
          placeholder="بنویسید و Enter بزنید"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
        />
      </label>
      <div className="admin-tag-list">
        {values.map((item) => (
          <span className="admin-tag" key={item}>
            {item}
            <button
              type="button"
              aria-label={`حذف ${item}`}
              onClick={() => onChange(values.filter((value) => value !== item))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <small>
        {values.length} از {max} مورد
      </small>
    </div>
  );
}

export function InstructorPublicEditor({
  userId,
  initial,
  onSaved,
}: {
  userId: string;
  initial: EditorState;
  onSaved?: (value: EditorState) => void;
}) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("basic");
  const [editingExperience, setEditingExperience] = useState<string | null>(
    null,
  );
  const [editingEducation, setEditingEducation] = useState<string | null>(null);
  const path = `/api/tenant/instructors/${encodeURIComponent(userId)}/public-profile`;
  function field<K extends keyof InstructorContent>(
    key: K,
    next: InstructorContent[K],
  ) {
    setValue((current) => ({
      ...current,
      content: { ...current.content, [key]: next },
    }));
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await apiRequest<EditorState>(path, {
        method: "PUT",
        body: {
          slug: value.slug,
          published: value.published,
          content: value.content,
        },
      });
      setValue(result);
      setMessage("پروفایل ذخیره شد.");
      onSaved?.(result);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="website-editor" onSubmit={save}>
      <nav className="instructor-editor-tabs" aria-label="بخش‌های پروفایل مدرس">
        {(
          [
            ["basic", "اطلاعات اصلی"],
            ["resume", "رزومه"],
            ["experience", "سوابق کاری"],
            ["education", "تحصیلات"],
            ["works", "آثار و افتخارات"],
            ["media", "رسانه و لینک‌ها"],
            ["publication", "نمایش عمومی"],
          ] as const
        ).map(([key, label]) => (
          <AdminButton
            key={key}
            type="button"
            tone={section === key ? "info" : "neutral"}
            aria-current={section === key ? "page" : undefined}
            onClick={() => setSection(key)}
          >
            {label}
          </AdminButton>
        ))}
      </nav>
      {section === "basic" && (
        <section className="card card-pad">
          <h2 className="card-title">اطلاعات اصلی</h2>
          <div className="admin-profile-photo-panel">
            <div className="admin-profile-photo-preview">
              {value.content.photoUrl ? (
                <img
                  src={value.content.photoUrl}
                  alt={`تصویر ${value.content.name}`}
                />
              ) : (
                <span aria-hidden="true">{value.content.name.slice(0, 1)}</span>
              )}
            </div>
            <div>
              <strong>تصویر پروفایل</strong>
              <p className="hint">
                تصویر مدرس در فهرست و صفحه عمومی نمایش داده می‌شود.
              </p>
              {value.id ? (
                <MediaUploader
                  kind="INSTRUCTOR_PHOTO"
                  resourceId={value.id}
                  label="تصویر مدرس"
                  value={value.content.photoUrl}
                  onChange={(url) => field("photoUrl", url)}
                />
              ) : (
                <p className="hint">
                  برای بارگذاری تصویر، ابتدا پروفایل را ذخیره کنید.
                </p>
              )}
            </div>
          </div>
          <div className="website-editor-grid">
            <label>
              <span>نام عمومی</span>
              <input
                required
                value={value.content.name}
                onChange={(e) => field("name", e.target.value)}
              />
            </label>
            <label>
              <span>عنوان حرفه‌ای</span>
              <input
                value={value.content.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label>
              <span>شناسه صفحه</span>
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={value.slug}
                onChange={(e) => setValue({ ...value, slug: e.target.value })}
              />
            </label>
            <label>
              <span>سال‌های تجربه (اختیاری)</span>
              <input
                type="number"
                min="0"
                max="80"
                value={value.content.yearsExperience ?? ""}
                onChange={(e) =>
                  field(
                    "yearsExperience",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </label>
            <label className="website-wide">
              <span>معرفی کوتاه</span>
              <textarea
                maxLength={500}
                value={value.content.shortBio}
                onChange={(e) => field("shortBio", e.target.value)}
              />
            </label>
            <label className="website-wide">
              <span>زندگی‌نامه</span>
              <textarea
                rows={7}
                maxLength={5000}
                value={value.content.biography}
                onChange={(e) => field("biography", e.target.value)}
              />
            </label>
            <label className="website-wide">
              <span>عنوان سئو (اختیاری)</span>
              <input
                maxLength={160}
                value={value.content.seoTitle}
                onChange={(e) => field("seoTitle", e.target.value)}
              />
            </label>
            <label className="website-wide">
              <span>توضیح سئو (اختیاری)</span>
              <textarea
                maxLength={300}
                value={value.content.metaDescription}
                onChange={(e) => field("metaDescription", e.target.value)}
              />
            </label>
            <label className="website-wide">
              <span>مسیر canonical (اختیاری، همین سایت)</span>
              <input
                placeholder="/instructors/example"
                value={value.content.canonicalPath}
                onChange={(e) => field("canonicalPath", e.target.value)}
              />
            </label>
            <TagInput
              label="تخصص‌ها"
              values={value.content.specialties}
              onChange={(values) => field("specialties", values)}
              max={16}
            />
          </div>
        </section>
      )}
      {section === "experience" && (
        <section className="card card-pad">
          <h2 className="card-title">سوابق کاری</h2>
          {value.content.experience.length === 0 && (
            <p className="hint">هنوز سابقه کاری ثبت نشده است.</p>
          )}
          {value.content.experience.map((item, index) => (
            <div className="admin-history-card" key={item.id}>
              <button
                type="button"
                className="admin-history-summary"
                aria-expanded={editingExperience === item.id}
                onClick={() =>
                  setEditingExperience(
                    editingExperience === item.id ? null : item.id,
                  )
                }
              >
                <strong>{item.position || "سابقه کاری جدید"}</strong>
                <span>
                  {item.organization || "نام سازمان"} · {item.startYear ?? "—"}{" "}
                  تا {item.current ? "اکنون" : (item.endYear ?? "—")}
                </span>
                <span className="admin-action admin-action-info">ویرایش</span>
              </button>
              {editingExperience === item.id && (
                <div className="website-editor-grid public-repeatable">
                  {(
                    [
                      ["position", "سمت"],
                      ["organization", "سازمان"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        value={item[key]}
                        onChange={(e) =>
                          field(
                            "experience",
                            value.content.experience.map((row, i) =>
                              i === index
                                ? { ...row, [key]: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  {(
                    [
                      ["startYear", "سال شروع"],
                      ["endYear", "سال پایان"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        type="number"
                        min="1900"
                        max="2200"
                        value={item[key] ?? ""}
                        onChange={(e) =>
                          field(
                            "experience",
                            value.content.experience.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    [key]: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={item.current}
                      onChange={(e) =>
                        field(
                          "experience",
                          value.content.experience.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  current: e.target.checked,
                                  endYear: e.target.checked
                                    ? null
                                    : row.endYear,
                                }
                              : row,
                          ),
                        )
                      }
                    />{" "}
                    تاکنون
                  </label>
                  <label className="website-wide">
                    <span>توضیح</span>
                    <textarea
                      value={item.description}
                      onChange={(e) =>
                        field(
                          "experience",
                          value.content.experience.map((row, i) =>
                            i === index
                              ? { ...row, description: e.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() =>
                      field(
                        "experience",
                        value.content.experience.filter((_, i) => i !== index),
                      )
                    }
                  >
                    حذف سابقه
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const id = crypto.randomUUID();
              setEditingExperience(id);
              field("experience", [
                ...value.content.experience,
                {
                  id,
                  position: "",
                  organization: "",
                  startYear: null,
                  endYear: null,
                  current: false,
                  description: "",
                },
              ]);
            }}
          >
            + افزودن سابقه
          </button>
        </section>
      )}
      {section === "education" && (
        <section className="card card-pad">
          <h2 className="card-title">تحصیلات</h2>
          {value.content.education.length === 0 && (
            <p className="hint">هنوز تحصیلات ثبت نشده است.</p>
          )}
          {value.content.education.map((item, index) => (
            <div className="admin-history-card" key={item.id}>
              <button
                type="button"
                className="admin-history-summary"
                aria-expanded={editingEducation === item.id}
                onClick={() =>
                  setEditingEducation(
                    editingEducation === item.id ? null : item.id,
                  )
                }
              >
                <strong>
                  {item.degree || "مدرک جدید"}
                  {item.field ? ` ${item.field}` : ""}
                </strong>
                <span>
                  {item.institution || "نام مؤسسه"} · {item.year ?? "—"}
                </span>
                <span className="admin-action admin-action-info">ویرایش</span>
              </button>
              {editingEducation === item.id && (
                <div className="website-editor-grid public-repeatable">
                  {(
                    [
                      ["degree", "مدرک"],
                      ["field", "رشته"],
                      ["institution", "مؤسسه"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <input
                        value={item[key]}
                        onChange={(e) =>
                          field(
                            "education",
                            value.content.education.map((row, i) =>
                              i === index
                                ? { ...row, [key]: e.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <label>
                    <span>سال</span>
                    <input
                      type="number"
                      min="1900"
                      max="2200"
                      value={item.year ?? ""}
                      onChange={(e) =>
                        field(
                          "education",
                          value.content.education.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  year: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() =>
                      field(
                        "education",
                        value.content.education.filter((_, i) => i !== index),
                      )
                    }
                  >
                    حذف تحصیلات
                  </button>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const id = crypto.randomUUID();
              setEditingEducation(id);
              field("education", [
                ...value.content.education,
                {
                  id,
                  degree: "",
                  field: "",
                  institution: "",
                  year: null,
                },
              ]);
            }}
          >
            + افزودن تحصیلات
          </button>
        </section>
      )}
      {section === "works" && (
        <section className="card card-pad">
          <h2 className="card-title">افتخارات، آثار و پروژه‌ها</h2>
          <div className="website-editor-grid">
            {lists.map(([key, label]) => (
              <TagInput
                key={key}
                label={label}
                values={value.content[key]}
                onChange={(values) => field(key, values)}
              />
            ))}
          </div>
        </section>
      )}
      {section === "media" && (
        <section className="card card-pad">
          <h2 className="card-title">پیوندها و رسانه</h2>
          <div className="website-editor-grid">
            <label>
              <span>وب‌سایت HTTPS</span>
              <input
                type="url"
                value={value.content.websiteUrl}
                onChange={(e) => field("websiteUrl", e.target.value)}
              />
            </label>
            <label>
              <span>لینکدین HTTPS</span>
              <input
                type="url"
                value={value.content.linkedInUrl}
                onChange={(e) => field("linkedInUrl", e.target.value)}
              />
            </label>
            {value.id && (
              <MediaUploader
                kind="INSTRUCTOR_PHOTO"
                resourceId={value.id}
                label="تصویر مدرس"
                value={value.content.photoUrl}
                onChange={(url) => field("photoUrl", url)}
              />
            )}
            {!value.id && (
              <p className="hint">
                برای بارگذاری تصویر، ابتدا پروفایل را ذخیره کنید.
              </p>
            )}
          </div>
        </section>
      )}
      {section === "resume" && (
        <section className="card card-pad admin-resume-section">
          <h2 className="card-title">رزومه مدرس</h2>
          <p className="hint">
            فایل PDF رزومه را بارگذاری یا جایگزین کنید و نمایش عمومی آن را کنترل
            کنید.
          </p>
          {value.id ? (
            <MediaUploader
              kind="INSTRUCTOR_RESUME"
              resourceId={value.id}
              label="رزومه PDF"
              value={value.content.resumeUrl}
              onChange={(url) => field("resumeUrl", url)}
            />
          ) : (
            <p className="hint">
              برای بارگذاری رزومه، ابتدا پروفایل را ذخیره کنید.
            </p>
          )}
          <label className="admin-resume-toggle">
            <input
              type="checkbox"
              checked={value.content.showResume}
              onChange={(event) => field("showResume", event.target.checked)}
            />
            <span>
              <strong>نمایش رزومه در وب‌سایت</strong>
              <small>
                بازدیدکنندگان صفحه عمومی می‌توانند فایل رزومه را دریافت کنند.
              </small>
            </span>
          </label>
        </section>
      )}
      {section === "publication" && (
        <section className="card card-pad">
          <div className="admin-publication-summary">
            <StatusBadge status={value.published ? "PUBLISHED" : "DRAFT"} />
            <strong>
              {value.published
                ? "این پروفایل برای بازدیدکنندگان منتشر می‌شود."
                : "این پروفایل در حالت پیش‌نویس است."}
            </strong>
          </div>
          <label className="admin-publication-toggle">
            <input
              type="checkbox"
              checked={value.published}
              onChange={(e) =>
                setValue({ ...value, published: e.target.checked })
              }
            />{" "}
            انتشار پروفایل عمومی
          </label>
          <div className="admin-publication-settings">
            {(
              [
                ["showExperience", "نمایش سوابق کاری"],
                ["showEducation", "نمایش تحصیلات"],
                ["showWorks", "نمایش آثار و افتخارات"],
                ["showResume", "نمایش فایل رزومه"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={value.content[key]}
                  onChange={(event) => field(key, event.target.checked)}
                />{" "}
                {label}
              </label>
            ))}
          </div>
          {initial.published && value.published && (
            <a
              className="admin-action admin-action-neutral"
              href={`/instructors/${initial.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              مشاهده پروفایل عمومی
            </a>
          )}
          {message && <p role="status">{message}</p>}
        </section>
      )}
      <div className="admin-dialog-footer">
        <AdminButton type="submit" tone="primary" disabled={busy}>
          {busy ? "در حال ذخیره..." : "ذخیره تغییرات"}
        </AdminButton>
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
