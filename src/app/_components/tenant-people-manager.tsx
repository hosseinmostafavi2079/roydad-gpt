"use client";

import { roleLabel } from "@/modules/tenant-identity/role-labels";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "@/app/_components/api-client";
import type { InstructorContent } from "@/modules/public-site/instructors";
import { InstructorPublicEditor } from "./instructor-public-editor";
import {
  AdminButton,
  AdminDialog,
  ConfirmationDialog,
  StatusBadge,
} from "./admin-ui";

type Person = {
  id: string;
  name: string;
  email: string;
  status: string;
  role_codes: string[];
  last_login_at: string | null;
};
type Role = { code: string; name: string };
type PublicProfile = {
  id: string;
  slug: string;
  published: boolean;
  content: InstructorContent;
};
type Collection = "staff" | "instructors" | "participants";

const paths: Record<Collection, string> = {
  staff: "/api/tenant/identity/staff",
  instructors: "/api/tenant/identity/instructors",
  participants: "/api/tenant/identity/participants",
};

export function TenantPeopleManager({
  collection,
  canInvite,
  canAssign,
  canReadRoles,
  canEdit,
  canSuspend,
  canDisable,
  defaultRole,
  profileSummaries = [],
}: {
  collection: Collection;
  canInvite: boolean;
  canAssign: boolean;
  canReadRoles: boolean;
  canEdit: boolean;
  canSuspend: boolean;
  canDisable: boolean;
  defaultRole: string;
  profileSummaries?: Array<{
    userId: string;
    title: string;
    specialties: string[];
    photoUrl: string;
    slug: string;
    published: boolean;
  }>;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([defaultRole]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"invite" | "name" | "roles" | null>(
    null,
  );
  const [editing, setEditing] = useState<Person | null>(null);
  const [confirmPerson, setConfirmPerson] = useState<Person | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<"SUSPENDED" | "DISABLED">(
    "SUSPENDED",
  );
  const [profileEditing, setProfileEditing] = useState<Person | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [participantProfile, setParticipantProfile] = useState<{
    name: string;
    fields: { key: string; label: string; value: unknown }[];
  } | null>(null);
  const [profileOverrides, setProfileOverrides] = useState<
    Record<string, PublicProfile>
  >({});
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [publicationFilter, setPublicationFilter] = useState("");
  const isInstructor = collection === "instructors";
  const summaryFor = (person: Person) => {
    const base = profileSummaries.find((item) => item.userId === person.id);
    const changed = profileOverrides[person.id];
    return {
      title: changed?.content.title ?? base?.title ?? "",
      specialties: changed?.content.specialties ?? base?.specialties ?? [],
      photoUrl: changed?.content.photoUrl ?? base?.photoUrl ?? "",
      slug: changed?.slug ?? base?.slug ?? "",
      published: changed?.published ?? base?.published ?? false,
    };
  };
  const shown = people.filter((person) => {
    const term = search.trim().toLocaleLowerCase();
    return (
      (!term ||
        `${person.name} ${person.email} ${isInstructor ? summaryFor(person).title : ""}`
          .toLocaleLowerCase()
          .includes(term)) &&
      (!accountFilter || person.status === accountFilter) &&
      (!isInstructor ||
        !publicationFilter ||
        String(summaryFor(person).published) === publicationFilter)
    );
  });

  const load = useCallback(async () => {
    const [users, roleRows] = await Promise.all([
      apiRequest<Person[]>(paths[collection]),
      canReadRoles
        ? apiRequest<Role[]>("/api/tenant/roles")
        : Promise.resolve([] as Role[]),
    ]);
    setPeople(users);
    setRoles(roleRows);
    setAssignments(
      Object.fromEntries(users.map((person) => [person.id, person.role_codes])),
    );
  }, [collection, canReadRoles]);

  useEffect(() => {
    void load().catch((cause) => setError(errorMessage(cause)));
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(paths[collection], {
        method: "POST",
        body: { name, email, roleCodes: selected },
      });
      setName("");
      setEmail("");
      setNotice("پیوند فعال‌سازی برای کاربر ارسال شد.");
      setDialog(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveRoles(person: Person) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/api/tenant/identity/users/${person.id}/roles`, {
        method: "PUT",
        body: { roleCodes: assignments[person.id] ?? [] },
      });
      setNotice("نقش‌های کاربر به‌روزرسانی شد.");
      setDialog(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(
    person: Person,
    status: "ACTIVE" | "SUSPENDED" | "DISABLED",
  ) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/identity/users/${person.id}`, {
        method: "PATCH",
        body: { status },
      });
      await load();
      setConfirmPerson(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function updateProfile(
    person: Person,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/identity/users/${person.id}`, {
        method: "PATCH",
        body: { name: String(data.get("name")) },
      });
      setNotice("مشخصات کاربر به‌روزرسانی شد.");
      setDialog(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(person: Person) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/identity/users/${person.id}/invitation`, {
        method: "POST",
        body: {},
      });
      setNotice("دعوت‌نامه باطل شد.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function editInstructor(person: Person) {
    setProfileEditing(person);
    setProfile(null);
    setProfileBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/tenant/instructors/${encodeURIComponent(person.id)}/public-profile`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const payload = (await response.json()) as {
        data?: PublicProfile | null;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "پروفایل بارگذاری نشد.");
      const summary = profileSummaries.find(
        (item) => item.userId === person.id,
      );
      const content: InstructorContent = {
        name: person.name,
        title: summary?.title ?? "",
        shortBio: "",
        biography: "",
        specialties: summary?.specialties ?? [],
        yearsExperience: null,
        experience: [],
        education: [],
        certifications: [],
        honors: [],
        books: [],
        publications: [],
        projects: [],
        websiteUrl: "",
        linkedInUrl: "",
        photoUrl: summary?.photoUrl ?? "",
        resumeUrl: "",
        showResume: false,
        showExperience: true,
        showEducation: true,
        showWorks: true,
        seoTitle: "",
        metaDescription: "",
        canonicalPath: "",
      };
      setProfile(
        payload.data ?? {
          id: "",
          slug: summary?.slug || `teacher-${person.id.slice(0, 8)}`,
          published: false,
          content,
        },
      );
      setProfileEditing(person);
    } catch (cause) {
      setError(errorMessage(cause));
      setProfileEditing(null);
    } finally {
      setProfileBusy(false);
    }
  }

  return (
    <div className="admin-workspace">
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      <div className="admin-metrics">
        <div>
          <span>{isInstructor ? "کل مدرسان" : "کل کارکنان"}</span>
          <strong>{people.length.toLocaleString("fa-IR")}</strong>
        </div>
        <div>
          <span>{isInstructor ? "پروفایل منتشرشده" : "حساب‌های فعال"}</span>
          <strong>
            {people
              .filter((person) =>
                isInstructor
                  ? summaryFor(person).published
                  : person.status === "ACTIVE",
              )
              .length.toLocaleString("fa-IR")}
          </strong>
        </div>
        <div>
          <span>دعوت‌های در انتظار</span>
          <strong>
            {people
              .filter((person) => person.status === "INVITED")
              .length.toLocaleString("fa-IR")}
          </strong>
        </div>
        {isInstructor && (
          <div>
            <span>مدرسان فعال</span>
            <strong>
              {people
                .filter((person) => person.status === "ACTIVE")
                .length.toLocaleString("fa-IR")}
            </strong>
          </div>
        )}
      </div>
      <div className="admin-list-toolbar">
        <div className="admin-toolbar">
          <label>
            جستجو
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                isInstructor ? "نام، ایمیل یا عنوان مدرس" : "نام یا ایمیل"
              }
            />
          </label>
          <label>
            وضعیت حساب
            <select
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="ACTIVE">فعال</option>
              <option value="INVITED">دعوت‌شده</option>
              <option value="SUSPENDED">تعلیق‌شده</option>
            </select>
          </label>
          {isInstructor && (
            <label>
              پروفایل عمومی
              <select
                value={publicationFilter}
                onChange={(event) => setPublicationFilter(event.target.value)}
              >
                <option value="">همه پروفایل‌ها</option>
                <option value="true">منتشرشده</option>
                <option value="false">پیش‌نویس</option>
              </select>
            </label>
          )}
        </div>
        {canInvite && (
          <AdminButton
            type="button"
            tone="primary"
            icon="create"
            onClick={() => {
              setSelected([defaultRole]);
              setDialog("invite");
            }}
          >
            دعوت {isInstructor ? "مدرس" : "کاربر"}
          </AdminButton>
        )}
      </div>
      {canInvite && (
        <AdminDialog
          open={dialog === "invite"}
          title={collection === "instructors" ? "دعوت مدرس" : "دعوت کاربر"}
          onClose={() => !busy && setDialog(null)}
        >
          <form className="form-grid" onSubmit={invite}>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="invite-name">
                  نام
                </label>
                <input
                  className="input"
                  id="invite-name"
                  required
                  minLength={2}
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="invite-email">
                  ایمیل
                </label>
                <input
                  className="input"
                  id="invite-email"
                  type="email"
                  dir="ltr"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {collection === "instructors" && (
                <details className="admin-advanced">
                  <summary>تنظیمات بیشتر</summary>
                  <p className="hint">نقش مدرس به‌صورت پیش‌فرض انتخاب شده است.</p>
                  {roles
                    .filter((role) => role.code !== defaultRole)
                    .map((role) => (
                      <label className="check-label" key={role.code}>
                        <input
                          type="checkbox"
                          checked={selected.includes(role.code)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, role.code]
                                : current.filter((code) => code !== role.code),
                            )
                          }
                        />
                        {roleLabel(role.code, role.name)}
                      </label>
                    ))}
                </details>
              )}
              {collection !== "instructors" && (
                <div className="field field-full">
                  <span className="label">نقش‌های آغازین</span>
                  {roles.length ? (
                    <div className="check-row" style={{ flexWrap: "wrap" }}>
                      {roles.map((role) => (
                        <label className="check-label" key={role.code}>
                          <input
                            type="checkbox"
                            checked={selected.includes(role.code)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, role.code]
                                  : current.filter(
                                      (code) => code !== role.code,
                                    ),
                              )
                            }
                          />
                          {roleLabel(role.code, role.name)}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">
                      نقش پیش‌فرض این بخش به کاربر داده می‌شود.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || selected.length === 0}
              >
                {busy ? "در حال ارسال…" : "ارسال دعوت"}
              </button>
            </div>
          </form>
        </AdminDialog>
      )}
      {isInstructor && (
        <div className="admin-instructor-grid">
          {shown.map((person) => {
            const summary = summaryFor(person);
            return (
              <article className="admin-instructor-card" key={person.id}>
                <div className="admin-instructor-head">
                  {summary.photoUrl ? (
                    <img
                      className="admin-instructor-photo"
                      src={summary.photoUrl}
                      alt={`تصویر ${person.name}`}
                    />
                  ) : (
                    <span
                      className="admin-instructor-photo admin-person-initial"
                      aria-hidden="true"
                    >
                      {person.name.slice(0, 1)}
                    </span>
                  )}
                  <div className="admin-instructor-identity">
                    <h2>{person.name}</h2>
                    <p>{summary.title || "عنوان حرفه‌ای ثبت نشده"}</p>
                    <small dir="ltr">{person.email}</small>
                  </div>
                </div>
                <div className="admin-instructor-specialties">
                  {summary.specialties.length ? (
                    summary.specialties
                      .slice(0, 4)
                      .map((specialty) => (
                        <span key={specialty}>{specialty}</span>
                      ))
                  ) : (
                    <span>تخصصی ثبت نشده است</span>
                  )}
                </div>
                <div className="admin-instructor-meta">
                  <span>
                    حساب <StatusBadge status={person.status} />
                  </span>
                  <span>
                    پروفایل عمومی{" "}
                    <StatusBadge
                      status={summary.published ? "PUBLISHED" : "DRAFT"}
                    />
                  </span>
                </div>
                <div className="admin-instructor-actions">
                  {summary.published && summary.slug && (
                    <a
                      className="admin-action admin-action-neutral"
                      href={`/instructors/${summary.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      مشاهده
                    </a>
                  )}
                  {canEdit && (
                    <AdminButton
                      type="button"
                      tone="info"
                      icon="edit"
                      disabled={profileBusy}
                      onClick={() => void editInstructor(person)}
                    >
                      ویرایش پروفایل
                    </AdminButton>
                  )}
                  {(canAssign || canSuspend || canEdit) && (
                    <details className="admin-more">
                      <summary
                        className="admin-action admin-action-neutral"
                        aria-label={`عملیات بیشتر ${person.name}`}
                      >
                        ⋯
                      </summary>
                      <div className="admin-more-panel">
                        {canEdit && (
                          <AdminButton
                            type="button"
                            onClick={() => {
                              setEditing(person);
                              setDialog("name");
                            }}
                          >
                            ویرایش نام
                          </AdminButton>
                        )}
                        {canAssign && (
                          <AdminButton
                            type="button"
                            onClick={() => {
                              setEditing(person);
                              setDialog("roles");
                            }}
                          >
                            مدیریت نقش‌ها
                          </AdminButton>
                        )}
                        {canSuspend && person.status === "ACTIVE" && (
                          <AdminButton
                            type="button"
                            tone="warning"
                            onClick={() => {
                              setConfirmStatus("SUSPENDED");
                              setConfirmPerson(person);
                            }}
                          >
                            تعلیق حساب
                          </AdminButton>
                        )}
                        {canSuspend && person.status === "SUSPENDED" && (
                          <AdminButton
                            type="button"
                            tone="success"
                            onClick={() => void changeStatus(person, "ACTIVE")}
                          >
                            فعال‌سازی
                          </AdminButton>
                        )}
                        {canSuspend && person.status === "INVITED" && (
                          <AdminButton
                            type="button"
                            tone="danger"
                            onClick={() => setConfirmPerson(person)}
                          >
                            ابطال دعوت
                          </AdminButton>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
          {shown.length === 0 && (
            <div className="admin-empty-state">
              <strong>
                {people.length
                  ? "مدرسی با این مشخصات پیدا نشد."
                  : "هنوز مدرسی اضافه نشده است."}
              </strong>
              <p>
                {people.length
                  ? "فیلترها را تغییر دهید."
                  : "برای شروع اولین مدرس مجموعه را دعوت کنید."}
              </p>
              {!people.length && canInvite && (
                <AdminButton
                  type="button"
                  tone="primary"
                  icon="create"
                  onClick={() => setDialog("invite")}
                >
                  افزودن اولین مدرس
                </AdminButton>
              )}
            </div>
          )}
        </div>
      )}
      {["staff", "participants"].includes(collection) && (
        <div className="card table-wrap admin-people-table">
          <table className="admin-table admin-card-table">
            <thead>
              <tr>
                <th>نام و ایمیل</th>
                <th>وضعیت حساب</th>
                {collection === "instructors" && <th>پروفایل عمومی</th>}
                <th>نقش‌ها</th>
                <th>آخرین ورود</th>
                {(canAssign || canSuspend || canEdit) && <th>مدیریت</th>}
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((person) => (
                  <tr key={person.id}>
                    <td data-label="نام و ایمیل">
                      {collection === "staff" && (
                        <span
                          className="admin-person-photo admin-person-initial"
                          aria-hidden="true"
                        >
                          {person.name.slice(0, 1)}
                        </span>
                      )}
                      {collection === "instructors" &&
                        (() => {
                          const photo =
                            profileOverrides[person.id]?.content.photoUrl ??
                            profileSummaries.find(
                              (item) => item.userId === person.id,
                            )?.photoUrl;
                          return photo ? (
                            <img
                              className="admin-person-photo"
                              src={photo}
                              alt=""
                            />
                          ) : (
                            <span
                              className="admin-person-photo admin-person-initial"
                              aria-hidden="true"
                            >
                              {person.name.slice(0, 1)}
                            </span>
                          );
                        })()}
                      <span className="table-name">{person.name}</span>
                      <span className="table-sub">{person.email}</span>
                      {collection === "participants" && (
                        <AdminButton
                          type="button"
                          onClick={async () => {
                            try {
                              const fields = await apiRequest<
                                { key: string; label: string; value: unknown }[]
                              >(
                                `/api/tenant/identity/participants/${person.id}/profile`,
                              );
                              setParticipantProfile({
                                name: person.name,
                                fields,
                              });
                            } catch (error) {
                              setError(errorMessage(error));
                            }
                          }}
                        >
                          اطلاعات پروفایل
                        </AdminButton>
                      )}
                    </td>
                    <td data-label="وضعیت حساب">
                      <StatusBadge status={person.status} />
                    </td>
                    {collection === "instructors" && (
                      <td data-label="پروفایل عمومی">
                        {(() => {
                          const profile = profileSummaries.find(
                            (item) => item.userId === person.id,
                          );
                          const override = profileOverrides[person.id];
                          return profile || override ? (
                            <>
                              <StatusBadge
                                status={
                                  (override?.published ?? profile?.published)
                                    ? "PUBLISHED"
                                    : "DRAFT"
                                }
                              />
                              <span className="table-sub">
                                {override?.content.title ||
                                  profile?.title ||
                                  override?.content.specialties.join("، ") ||
                                  profile?.specialties.join("، ")}
                              </span>
                            </>
                          ) : (
                            <StatusBadge status="DRAFT" />
                          );
                        })()}
                      </td>
                    )}
                    <td data-label="نقش‌ها">
                      {person.role_codes
                        .map((code) => roleLabel(code))
                        .join("، ") || "—"}
                    </td>
                    <td data-label="آخرین ورود">
                      {person.last_login_at
                        ? new Date(person.last_login_at).toLocaleDateString(
                            "fa-IR-u-ca-persian",
                          )
                        : "—"}
                    </td>
                    {(canAssign || canSuspend || canEdit) && (
                      <td data-label="مدیریت">
                        <div className="admin-row-actions">
                          {collection === "instructors" && canEdit && (
                            <AdminButton
                              type="button"
                              tone="info"
                              icon="edit"
                              disabled={profileBusy}
                              onClick={() => void editInstructor(person)}
                            >
                              ویرایش پروفایل
                            </AdminButton>
                          )}
                          {canEdit && (
                            <AdminButton
                              type="button"
                              tone="info"
                              icon="edit"
                              onClick={() => {
                                setEditing(person);
                                setDialog("name");
                              }}
                            >
                              ویرایش
                            </AdminButton>
                          )}
                          {collection === "staff" && canAssign && (
                            <AdminButton
                              type="button"
                              tone="info"
                              onClick={() => {
                                setEditing(person);
                                setDialog("roles");
                              }}
                            >
                              ویرایش نقش‌ها
                            </AdminButton>
                          )}
                          {canAssign && (
                            <details>
                              <summary className="admin-action admin-action-neutral">
                                بیشتر
                              </summary>
                              <div className="card card-pad">
                                {collection !== "staff" && (
                                  <AdminButton
                                    type="button"
                                    onClick={() => {
                                      setEditing(person);
                                      setDialog("roles");
                                    }}
                                  >
                                    مدیریت نقش‌ها
                                  </AdminButton>
                                )}
                                {canSuspend && person.status === "ACTIVE" && (
                                  <AdminButton
                                    type="button"
                                    tone="warning"
                                    onClick={() => {
                                      setConfirmStatus("SUSPENDED");
                                      setConfirmPerson(person);
                                    }}
                                  >
                                    تعلیق حساب
                                  </AdminButton>
                                )}
                                {canDisable && person.status === "ACTIVE" && (
                                  <AdminButton
                                    type="button"
                                    tone="danger"
                                    onClick={() => {
                                      setConfirmStatus("DISABLED");
                                      setConfirmPerson(person);
                                    }}
                                  >
                                    غیرفعال‌سازی
                                  </AdminButton>
                                )}
                                {collection === "instructors" &&
                                  (() => {
                                    const publicProfile =
                                      profileOverrides[person.id] ??
                                      profileSummaries.find(
                                        (item) => item.userId === person.id,
                                      );
                                    return publicProfile?.published &&
                                      publicProfile.slug ? (
                                      <a
                                        className="admin-action admin-action-neutral"
                                        href={`/instructors/${publicProfile.slug}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        مشاهده عمومی
                                      </a>
                                    ) : null;
                                  })()}
                              </div>
                            </details>
                          )}
                          {canSuspend && person.status === "INVITED" && (
                            <AdminButton
                              type="button"
                              tone="danger"
                              disabled={busy}
                              onClick={() => setConfirmPerson(person)}
                            >
                              ابطال دعوت
                            </AdminButton>
                          )}
                          {canSuspend && person.status === "SUSPENDED" && (
                            <AdminButton
                              type="button"
                              tone="success"
                              disabled={busy}
                              onClick={() =>
                                void changeStatus(person, "ACTIVE")
                              }
                            >
                              فعال‌سازی
                            </AdminButton>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={collection === "instructors" ? 6 : 5}
                    className="empty"
                  >
                    هنوز کاربری ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <AdminDialog
        open={participantProfile !== null}
        title={`پروفایل ${participantProfile?.name ?? ""}`}
        onClose={() => setParticipantProfile(null)}
      >
        {participantProfile?.fields.map((field) => (
          <div className="check-row" key={field.key}>
            <strong>{field.label}</strong>
            <span>
              {Array.isArray(field.value)
                ? field.value.join("، ")
                : typeof field.value === "boolean"
                  ? field.value
                    ? "بله"
                    : "خیر"
                  : String(field.value ?? "")}
            </span>
          </div>
        ))}
      </AdminDialog>
      <AdminDialog
        open={dialog === "name" && editing !== null}
        title="ویرایش اطلاعات"
        onClose={() => !busy && setDialog(null)}
      >
        {editing && (
          <form
            className="form-grid"
            onSubmit={(event) => void updateProfile(editing, event)}
          >
            <label>
              نام
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                defaultValue={editing.name}
              />
            </label>
            <AdminButton tone="primary" type="submit" disabled={busy}>
              {busy ? "در حال ذخیره..." : "ذخیره تغییرات"}
            </AdminButton>
          </form>
        )}
      </AdminDialog>
      <AdminDialog
        open={dialog === "roles" && editing !== null}
        title="نقش‌های کاربر"
        onClose={() => !busy && setDialog(null)}
      >
        {editing && (
          <div className="stack">
            {roles.map((role) => (
              <label className="admin-role-option" key={role.code}>
                <input
                  type="checkbox"
                  checked={(assignments[editing.id] ?? []).includes(role.code)}
                  onChange={(event) =>
                    setAssignments((current) => ({
                      ...current,
                      [editing.id]: event.target.checked
                        ? [...(current[editing.id] ?? []), role.code]
                        : (current[editing.id] ?? []).filter(
                            (code) => code !== role.code,
                          ),
                    }))
                  }
                />
                <span>
                  <strong>{roleLabel(role.code, role.name)}</strong>
                  <small>
                    {role.code === "course_manager"
                      ? "مدیریت برنامه‌ها و اجراها"
                      : role.code === "finance"
                        ? "دسترسی به امور مالی"
                        : role.code === "content_manager"
                          ? "مدیریت محتوای عمومی"
                          : "دسترسی‌های مرتبط با این نقش"}
                  </small>
                </span>
              </label>
            ))}
            <AdminButton
              type="button"
              tone="primary"
              disabled={busy}
              onClick={() => void saveRoles(editing)}
            >
              {busy ? "در حال ذخیره..." : "ذخیره نقش‌ها"}
            </AdminButton>
          </div>
        )}
      </AdminDialog>
      <ConfirmationDialog
        open={confirmPerson !== null}
        title={
          confirmPerson?.status === "INVITED"
            ? "ابطال دعوت"
            : confirmStatus === "DISABLED"
              ? "غیرفعال‌سازی حساب"
              : "تعلیق حساب"
        }
        description={
          confirmPerson?.status === "INVITED"
            ? "دعوت‌نامه این کاربر باطل شود؟"
            : confirmStatus === "DISABLED"
              ? "حساب این کاربر غیرفعال شود؟"
              : "حساب این کاربر تعلیق شود؟"
        }
        busy={busy}
        onClose={() => setConfirmPerson(null)}
        onConfirm={() => {
          if (!confirmPerson) return;
          if (confirmPerson.status === "INVITED")
            void revokeInvitation(confirmPerson).then(() =>
              setConfirmPerson(null),
            );
          else void changeStatus(confirmPerson, confirmStatus);
        }}
      />
      <AdminDialog
        open={profileEditing !== null}
        wide
        title={`ویرایش پروفایل ${profileEditing?.name ?? "مدرس"}`}
        onClose={() => {
          setProfileEditing(null);
          setProfile(null);
        }}
      >
        {profileBusy && (
          <div className="admin-loading" role="status">
            در حال بارگذاری پروفایل مدرس…
          </div>
        )}
        {profileEditing && profile && (
          <InstructorPublicEditor
            userId={profileEditing.id}
            initial={profile}
            onSaved={(saved) => {
              setProfileOverrides((current) => ({
                ...current,
                [profileEditing.id]: saved,
              }));
              setProfile(null);
              setProfileEditing(null);
              setNotice("تغییرات با موفقیت ذخیره شد.");
            }}
          />
        )}
      </AdminDialog>
    </div>
  );
}
