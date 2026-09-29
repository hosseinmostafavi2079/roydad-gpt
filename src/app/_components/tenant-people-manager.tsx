"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest, errorMessage } from "@/app/_components/api-client";

type Person = {
  id: string;
  name: string;
  email: string;
  status: string;
  role_codes: string[];
  last_login_at: string | null;
};
type Role = { code: string; name: string };
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
}: {
  collection: Collection;
  canInvite: boolean;
  canAssign: boolean;
  canReadRoles: boolean;
  canEdit: boolean;
  canSuspend: boolean;
  canDisable: boolean;
  defaultRole: string;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([defaultRole]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="grid">
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
      {canInvite && (
        <form className="card card-pad" onSubmit={invite}>
          <h2 className="card-title">دعوت کاربر</h2>
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
                              : current.filter((code) => code !== role.code),
                          )
                        }
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="hint">نقش پیش‌فرض این بخش به کاربر داده می‌شود.</p>
              )}
            </div>
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
      )}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>نام و ایمیل</th>
              <th>وضعیت</th>
              <th>نقش‌ها</th>
              <th>آخرین ورود</th>
              {(canAssign || canSuspend || canEdit) && <th>مدیریت</th>}
            </tr>
          </thead>
          <tbody>
            {people.length ? (
              people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <span className="table-name">{person.name}</span>
                    <span className="table-sub">{person.email}</span>
                  </td>
                  <td>{person.status}</td>
                  <td>{person.role_codes.join("، ") || "—"}</td>
                  <td>
                    {person.last_login_at
                      ? new Date(person.last_login_at).toLocaleDateString(
                          "fa-IR",
                        )
                      : "—"}
                  </td>
                  {(canAssign || canSuspend || canEdit) && (
                    <td>
                      {canEdit && (
                        <details>
                          <summary className="link">ویرایش</summary>
                          <form
                            onSubmit={(event) =>
                              void updateProfile(person, event)
                            }
                          >
                            <label
                              className="label"
                              htmlFor={`person-name-${person.id}`}
                            >
                              نام
                            </label>
                            <input
                              className="input"
                              id={`person-name-${person.id}`}
                              name="name"
                              required
                              minLength={2}
                              maxLength={120}
                              defaultValue={person.name}
                            />
                            <button
                              type="submit"
                              className="btn btn-primary btn-small"
                              disabled={busy}
                            >
                              ذخیره
                            </button>
                          </form>
                        </details>
                      )}
                      {canAssign && (
                        <details>
                          <summary className="link">نقش‌ها</summary>
                          <div
                            className="card card-pad"
                            style={{
                              position: "absolute",
                              zIndex: 3,
                              minWidth: 240,
                            }}
                          >
                            {roles.map((role) => (
                              <label className="check-label" key={role.code}>
                                <input
                                  type="checkbox"
                                  checked={(
                                    assignments[person.id] ?? []
                                  ).includes(role.code)}
                                  onChange={(event) =>
                                    setAssignments((current) => ({
                                      ...current,
                                      [person.id]: event.target.checked
                                        ? [
                                            ...(current[person.id] ?? []),
                                            role.code,
                                          ]
                                        : (current[person.id] ?? []).filter(
                                            (code) => code !== role.code,
                                          ),
                                    }))
                                  }
                                />
                                {role.name}
                              </label>
                            ))}
                            <button
                              type="button"
                              className="btn btn-primary btn-small"
                              disabled={busy}
                              onClick={() => void saveRoles(person)}
                            >
                              ذخیره نقش
                            </button>
                          </div>
                        </details>
                      )}
                      {canSuspend && person.status === "INVITED" && (
                        <button
                          type="button"
                          className="btn btn-danger btn-small"
                          disabled={busy}
                          onClick={() => void revokeInvitation(person)}
                        >
                          ابطال دعوت
                        </button>
                      )}
                      {canSuspend && person.status !== "INVITED" && (
                        <select
                          className="select"
                          aria-label={`وضعیت ${person.name}`}
                          value={person.status}
                          disabled={busy}
                          onChange={(event) =>
                            void changeStatus(
                              person,
                              event.target.value as
                                | "ACTIVE"
                                | "SUSPENDED"
                                | "DISABLED",
                            )
                          }
                        >
                          <option value="ACTIVE">فعال</option>
                          <option value="SUSPENDED">تعلیق</option>
                          <option value="DISABLED" disabled={!canDisable}>
                            غیرفعال
                          </option>
                        </select>
                      )}
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty">
                  هنوز کاربری ثبت نشده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
