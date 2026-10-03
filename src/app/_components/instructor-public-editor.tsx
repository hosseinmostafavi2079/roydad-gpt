"use client";

import { useState } from "react";
import type { InstructorContent } from "@/modules/public-site/instructors";
import { MediaUploader } from "./media-uploader";
import { apiRequest, errorMessage } from "./api-client";

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

export function InstructorPublicEditor({
  userId,
  initial,
}: {
  userId: string;
  initial: EditorState;
}) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="website-editor" onSubmit={save}>
      <section className="card card-pad">
        <h2 className="card-title">اطلاعات اصلی</h2>
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
          <label className="website-wide">
            <span>تخصص‌ها (هر خط یک مورد)</span>
            <textarea
              value={value.content.specialties.join("\n")}
              onChange={(e) =>
                field(
                  "specialties",
                  e.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
        </div>
      </section>
      <section className="card card-pad">
        <h2 className="card-title">سوابق کاری</h2>
        <label>
          <input
            type="checkbox"
            checked={value.content.showExperience}
            onChange={(e) => field("showExperience", e.target.checked)}
          />{" "}
          نمایش عمومی
        </label>
        {value.content.experience.map((item, index) => (
          <div className="website-editor-grid public-repeatable" key={item.id}>
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
                        i === index ? { ...row, [key]: e.target.value } : row,
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
                            endYear: e.target.checked ? null : row.endYear,
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
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            field("experience", [
              ...value.content.experience,
              {
                id: crypto.randomUUID(),
                position: "",
                organization: "",
                startYear: null,
                endYear: null,
                current: false,
                description: "",
              },
            ])
          }
        >
          + افزودن سابقه
        </button>
      </section>
      <section className="card card-pad">
        <h2 className="card-title">تحصیلات</h2>
        <label>
          <input
            type="checkbox"
            checked={value.content.showEducation}
            onChange={(e) => field("showEducation", e.target.checked)}
          />{" "}
          نمایش عمومی
        </label>
        {value.content.education.map((item, index) => (
          <div className="website-editor-grid public-repeatable" key={item.id}>
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
                        i === index ? { ...row, [key]: e.target.value } : row,
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
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            field("education", [
              ...value.content.education,
              {
                id: crypto.randomUUID(),
                degree: "",
                field: "",
                institution: "",
                year: null,
              },
            ])
          }
        >
          + افزودن تحصیلات
        </button>
      </section>
      <section className="card card-pad">
        <h2 className="card-title">افتخارات، آثار و پروژه‌ها</h2>
        <label>
          <input
            type="checkbox"
            checked={value.content.showWorks}
            onChange={(e) => field("showWorks", e.target.checked)}
          />{" "}
          نمایش عمومی
        </label>
        <div className="website-editor-grid">
          {lists.map(([key, label]) => (
            <label key={key}>
              <span>{label} (هر خط یک مورد)</span>
              <textarea
                value={value.content[key].join("\n")}
                onChange={(e) =>
                  field(
                    key,
                    e.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          ))}
        </div>
      </section>
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
            <>
              <MediaUploader
                kind="INSTRUCTOR_PHOTO"
                resourceId={value.id}
                label="تصویر مدرس"
                value={value.content.photoUrl}
                onChange={(url) => field("photoUrl", url)}
              />
              <MediaUploader
                kind="INSTRUCTOR_RESUME"
                resourceId={value.id}
                label="رزومه PDF"
                value={value.content.resumeUrl}
                onChange={(url) => field("resumeUrl", url)}
              />
            </>
          )}
          {!value.id && (
            <p className="hint">
              برای بارگذاری تصویر یا رزومه، ابتدا پروفایل را ذخیره کنید.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={value.content.showResume}
              onChange={(e) => field("showResume", e.target.checked)}
            />{" "}
            نمایش لینک رزومه پس از انتشار
          </label>
        </div>
      </section>
      <section className="card card-pad">
        <label>
          <input
            type="checkbox"
            checked={value.published}
            onChange={(e) =>
              setValue({ ...value, published: e.target.checked })
            }
          />{" "}
          انتشار پروفایل عمومی
        </label>
        <div>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "در حال ذخیره..." : "ذخیره پروفایل"}
          </button>
        </div>
        {value.published && (
          <a
            href={`/instructors/${value.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            مشاهده پروفایل عمومی
          </a>
        )}
        {message && <p role="status">{message}</p>}
      </section>
    </form>
  );
}
