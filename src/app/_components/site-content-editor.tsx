"use client";

import { useEffect, useState } from "react";
import type {
  InformationPageInput,
  SiteEntryInput,
} from "@/modules/public-site/content";
import { apiRequest, errorMessage } from "./api-client";
import { MediaUploader } from "./media-uploader";

type Kind = "FAQ" | "TESTIMONIAL" | "GALLERY" | "PAGE";
const blankEntry: Record<Exclude<Kind, "PAGE">, SiteEntryInput> = {
  FAQ: {
    enabled: false,
    order: 0,
    content: { kind: "FAQ", question: "", answer: "" },
  },
  TESTIMONIAL: {
    enabled: false,
    order: 0,
    content: {
      kind: "TESTIMONIAL",
      name: "",
      role: "",
      quote: "",
      photoUrl: "",
    },
  },
  GALLERY: {
    enabled: false,
    order: 0,
    content: { kind: "GALLERY", imageUrl: "", alt: "", caption: "" },
  },
};
const blankPage: InformationPageInput = {
  slug: "",
  title: "",
  blocks: [],
  seoTitle: "",
  metaDescription: "",
  published: false,
};
const labels = {
  FAQ: "سوالات متداول",
  TESTIMONIAL: "دیدگاه‌ها",
  GALLERY: "گالری",
  PAGE: "صفحات اطلاعاتی",
};

export function SiteContentEditor({ kind }: { kind: Kind }) {
  const [entries, setEntries] = useState<SiteEntryInput[]>([]);
  const [pages, setPages] = useState<InformationPageInput[]>([]);
  const [entry, setEntry] = useState<SiteEntryInput>(
    kind === "PAGE" ? blankEntry.FAQ : blankEntry[kind],
  );
  const [page, setPage] = useState<InformationPageInput>(blankPage);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind === "PAGE")
      void apiRequest<InformationPageInput[]>("/api/tenant/information-pages")
        .then(setPages)
        .catch(() => undefined);
    else
      void apiRequest<SiteEntryInput[]>(`/api/tenant/site-content?kind=${kind}`)
        .then(setEntries)
        .catch(() => undefined);
  }, [kind]);
  const setEntryContent = (key: string, value: string) =>
    setEntry(
      (current) =>
        ({
          ...current,
          content: { ...current.content, [key]: value },
        }) as SiteEntryInput,
    );
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      if (kind === "PAGE") {
        const result = await apiRequest<InformationPageInput>(
          "/api/tenant/information-pages",
          { method: "PUT", body: page },
        );
        setPage(result);
        setPages((all) => [
          ...all.filter((item) => item.id !== result.id),
          result,
        ]);
      } else {
        const result = await apiRequest<SiteEntryInput>(
          "/api/tenant/site-content",
          { method: "PUT", body: entry },
        );
        setEntry(result);
        setEntries((all) =>
          [...all.filter((item) => item.id !== result.id), result].sort(
            (a, b) => a.order - b.order,
          ),
        );
      }
      setMessage("ذخیره شد.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      className="site-content-editor"
      aria-label={labels[kind]}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <h2 className="card-title">{labels[kind]}</h2>
      <div className="website-editor-grid">
        <label>
          <span>انتخاب مورد</span>
          <select
            value={kind === "PAGE" ? (page.id ?? "") : (entry.id ?? "")}
            onChange={(e) => {
              if (kind === "PAGE")
                setPage(
                  pages.find((item) => item.id === e.target.value) ?? blankPage,
                );
              else
                setEntry(
                  entries.find((item) => item.id === e.target.value) ??
                    blankEntry[kind],
                );
            }}
          >
            <option value="">مورد جدید</option>
            {kind === "PAGE"
              ? pages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))
              : entries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.content.kind === "FAQ"
                      ? item.content.question
                      : item.content.kind === "TESTIMONIAL"
                        ? item.content.name
                        : item.content.caption || "تصویر"}
                  </option>
                ))}
          </select>
        </label>
        {kind === "PAGE" ? (
          <>
            <label>
              <span>عنوان صفحه</span>
              <input
                value={page.title}
                onChange={(e) => setPage({ ...page, title: e.target.value })}
              />
            </label>
            <label>
              <span>شناسه صفحه</span>
              <input
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={page.slug}
                onChange={(e) => setPage({ ...page, slug: e.target.value })}
              />
            </label>
            <label>
              <span>عنوان SEO</span>
              <input
                value={page.seoTitle}
                onChange={(e) => setPage({ ...page, seoTitle: e.target.value })}
              />
            </label>
            <label>
              <span>توضیح SEO</span>
              <textarea
                value={page.metaDescription}
                onChange={(e) =>
                  setPage({ ...page, metaDescription: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={page.published}
                onChange={(e) =>
                  setPage({ ...page, published: e.target.checked })
                }
              />{" "}
              انتشار صفحه
            </label>
          </>
        ) : (
          <>
            <label>
              <span>ترتیب</span>
              <input
                type="number"
                min="0"
                max="999"
                value={entry.order}
                onChange={(e) =>
                  setEntry({ ...entry, order: Number(e.target.value) })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) =>
                  setEntry({ ...entry, enabled: e.target.checked })
                }
              />{" "}
              نمایش عمومی
            </label>
            {entry.content.kind === "FAQ" && (
              <>
                <label>
                  <span>پرسش</span>
                  <input
                    value={entry.content.question}
                    onChange={(e) =>
                      setEntryContent("question", e.target.value)
                    }
                  />
                </label>
                <label className="website-wide">
                  <span>پاسخ</span>
                  <textarea
                    rows={4}
                    value={entry.content.answer}
                    onChange={(e) => setEntryContent("answer", e.target.value)}
                  />
                </label>
              </>
            )}
            {entry.content.kind === "TESTIMONIAL" && (
              <>
                <label>
                  <span>نام</span>
                  <input
                    value={entry.content.name}
                    onChange={(e) => setEntryContent("name", e.target.value)}
                  />
                </label>
                <label>
                  <span>عنوان/سمت</span>
                  <input
                    value={entry.content.role}
                    onChange={(e) => setEntryContent("role", e.target.value)}
                  />
                </label>
                <label className="website-wide">
                  <span>متن دیدگاه</span>
                  <textarea
                    value={entry.content.quote}
                    onChange={(e) => setEntryContent("quote", e.target.value)}
                  />
                </label>
                <label>
                  <span>تصویر (نشانی رسانهٔ مجموعه)</span>
                  <input
                    value={entry.content.photoUrl}
                    onChange={(e) =>
                      setEntryContent("photoUrl", e.target.value)
                    }
                  />
                </label>
              </>
            )}
            {entry.content.kind === "GALLERY" && (
              <>
                <label>
                  <span>متن جایگزین تصویر</span>
                  <input
                    value={entry.content.alt}
                    onChange={(e) => setEntryContent("alt", e.target.value)}
                  />
                </label>
                <label>
                  <span>شرح تصویر</span>
                  <input
                    value={entry.content.caption}
                    onChange={(e) => setEntryContent("caption", e.target.value)}
                  />
                </label>
                {entry.id ? (
                  <MediaUploader
                    kind="WEBSITE_GALLERY"
                    resourceId={entry.id}
                    label="تصویر گالری"
                    value={entry.content.imageUrl}
                    onChange={(url) => setEntryContent("imageUrl", url)}
                  />
                ) : (
                  <p className="hint">
                    برای بارگذاری تصویر ابتدا مورد را ذخیره کنید.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
      {kind === "PAGE" && (
        <div className="site-block-editor">
          <h3>بلوک‌های صفحه</h3>
          {page.blocks.map((block, index) => (
            <div className="public-repeatable" key={block.id}>
              <strong>
                {
                  (
                    {
                      heading: "عنوان",
                      text: "متن",
                      list: "فهرست",
                      image: "تصویر",
                      imageText: "تصویر و متن",
                      callout: "نکته",
                      cta: "دکمه",
                      faqGroup: "سوالات متداول",
                    } as const
                  )[block.type]
                }
              </strong>
              {(block.type === "heading" ||
                block.type === "text" ||
                block.type === "callout" ||
                block.type === "cta" ||
                block.type === "imageText") && (
                <label>
                  <span>متن</span>
                  <textarea
                    value={block.text}
                    onChange={(e) =>
                      setPage({
                        ...page,
                        blocks: page.blocks.map((item, i) =>
                          i === index
                            ? ({ ...item, text: e.target.value } as typeof item)
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              )}
              {block.type === "cta" && (
                <label>
                  <span>مسیر داخلی</span>
                  <input
                    value={block.href}
                    onChange={(e) =>
                      setPage({
                        ...page,
                        blocks: page.blocks.map((item, i) =>
                          i === index && item.type === "cta"
                            ? { ...item, href: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              )}
              {block.type === "list" && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={block.ordered}
                      onChange={(e) =>
                        setPage({
                          ...page,
                          blocks: page.blocks.map((item, i) =>
                            i === index && item.type === "list"
                              ? { ...item, ordered: e.target.checked }
                              : item,
                          ),
                        })
                      }
                    />{" "}
                    فهرست شماره‌دار
                  </label>
                  <label>
                    <span>هر سطر یک مورد</span>
                    <textarea
                      value={block.items.join("\n")}
                      onChange={(e) =>
                        setPage({
                          ...page,
                          blocks: page.blocks.map((item, i) =>
                            i === index && item.type === "list"
                              ? {
                                  ...item,
                                  items: e.target.value
                                    .split("\n")
                                    .map((line) => line.trim())
                                    .filter(Boolean),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                </>
              )}
              {(block.type === "image" || block.type === "imageText") && (
                <>
                  <label>
                    <span>نشانی تصویر رسانه</span>
                    <input
                      value={block.imageUrl}
                      onChange={(e) =>
                        setPage({
                          ...page,
                          blocks: page.blocks.map((item, i) =>
                            i === index &&
                            (item.type === "image" || item.type === "imageText")
                              ? { ...item, imageUrl: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>متن جایگزین</span>
                    <input
                      value={block.alt}
                      onChange={(e) =>
                        setPage({
                          ...page,
                          blocks: page.blocks.map((item, i) =>
                            i === index &&
                            (item.type === "image" || item.type === "imageText")
                              ? { ...item, alt: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                </>
              )}
              {block.type === "image" && (
                <label>
                  <span>شرح تصویر</span>
                  <input
                    value={block.caption}
                    onChange={(e) =>
                      setPage({
                        ...page,
                        blocks: page.blocks.map((item, i) =>
                          i === index && item.type === "image"
                            ? { ...item, caption: e.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() =>
                  setPage({
                    ...page,
                    blocks: page.blocks.filter((_, i) => i !== index),
                  })
                }
              >
                حذف بلوک
              </button>
            </div>
          ))}
          <label>
            <span>افزودن بلوک</span>
            <select
              value=""
              onChange={(e) => {
                const type = e.target.value;
                const block =
                  type === "heading"
                    ? { type: "heading" as const, text: "" }
                    : type === "text"
                      ? { type: "text" as const, text: "" }
                      : type === "list"
                        ? { type: "list" as const, ordered: false, items: [] }
                        : type === "callout"
                          ? { type: "callout" as const, text: "" }
                          : type === "cta"
                            ? {
                                type: "cta" as const,
                                text: "",
                                href: "/events",
                              }
                            : type === "image"
                              ? {
                                  type: "image" as const,
                                  imageUrl: "",
                                  alt: "",
                                  caption: "",
                                }
                              : type === "imageText"
                                ? {
                                    type: "imageText" as const,
                                    imageUrl: "",
                                    alt: "",
                                    text: "",
                                  }
                                : { type: "faqGroup" as const };
                setPage({
                  ...page,
                  blocks: [
                    ...page.blocks,
                    { id: crypto.randomUUID(), ...block },
                  ],
                });
              }}
            >
              <option value="">انتخاب بلوک</option>
              <option value="heading">عنوان</option>
              <option value="text">متن</option>
              <option value="list">فهرست</option>
              <option value="image">تصویر</option>
              <option value="imageText">تصویر و متن</option>
              <option value="callout">نکته</option>
              <option value="cta">دکمه</option>
              <option value="faqGroup">سوالات متداول</option>
            </select>
          </label>
        </div>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "در حال ذخیره..." : "ذخیره مورد"}
      </button>
      {kind !== "PAGE" && entry.id && (
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            try {
              await apiRequest(`/api/tenant/site-content?id=${entry.id}`, {
                method: "DELETE",
              });
              setEntries(entries.filter((item) => item.id !== entry.id));
              setEntry(blankEntry[kind]);
            } catch (error) {
              setMessage(errorMessage(error));
            }
          }}
        >
          حذف مورد
        </button>
      )}
      {kind === "PAGE" && page.published && (
        <a
          href={`/pages/${page.slug}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          مشاهده صفحه
        </a>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
