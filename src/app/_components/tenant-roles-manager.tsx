"use client";

import { roleLabel } from "@/modules/tenant-identity/role-labels";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { apiRequest, errorMessage } from "@/app/_components/api-client";

type Permission = {
  key: string;
  module: string;
  name: string;
  high_risk: boolean;
};
type Role = {
  id: string;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  permission_keys: string[];
  user_count: number;
};

const MODULE_LABELS: Record<string, string> = {
  dashboard: "داشبورد",
  staff: "کارکنان",
  roles: "نقش‌ها و دسترسی‌ها",
  participants: "شرکت‌کنندگان",
  instructors: "مدرسان",
  programs: "برنامه‌ها (آینده)",
  sessions: "جلسه‌ها (آینده)",
  enrollment: "ثبت‌نام (آینده)",
  attendance: "حضور و غیاب (آینده)",
  finance: "مالی (آینده)",
  certificates: "گواهی‌ها (آینده)",
  reports: "گزارش‌ها",
  settings: "تنظیمات",
  audit: "گزارش رویدادها",
};

const MODULE_ORDER = Object.keys(MODULE_LABELS);
const ACTION_LABELS: Record<string, string> = {
  read: "مشاهده",
  create: "ایجاد",
  update: "ویرایش",
  delete: "حذف",
  manage: "مدیریت",
  assign: "تخصیص",
  publish: "انتشار",
  suspend: "تعلیق",
  invite: "دعوت",
  export: "دریافت خروجی",
};
function permissionLabel(permission: Permission): string {
  const [module, action] = permission.key.split(".");
  return `${ACTION_LABELS[action ?? ""] ?? "مدیریت"} ${MODULE_LABELS[module ?? ""] ?? "دسترسی"}`;
}

export function TenantRolesManager({
  canCreate,
  canUpdate,
  canDelete,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const permissionGroups = useMemo(() => {
    const grouped = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const group = grouped.get(permission.module) ?? [];
      group.push(permission);
      grouped.set(permission.module, group);
    }
    return [...grouped.entries()].sort(
      ([left], [right]) =>
        (MODULE_ORDER.indexOf(left) < 0
          ? Number.MAX_SAFE_INTEGER
          : MODULE_ORDER.indexOf(left)) -
        (MODULE_ORDER.indexOf(right) < 0
          ? Number.MAX_SAFE_INTEGER
          : MODULE_ORDER.indexOf(right)),
    );
  }, [permissions]);

  const load = useCallback(async () => {
    const [roleRows, permissionRows] = await Promise.all([
      apiRequest<Role[]>("/api/tenant/roles"),
      apiRequest<Permission[]>("/api/tenant/roles/permissions"),
    ]);
    setRoles(roleRows);
    setPermissions(permissionRows);
  }, []);
  useEffect(() => {
    void load().catch((cause) => setError(errorMessage(cause)));
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/api/tenant/roles", {
        method: "POST",
        body: { code, name, description, permissionKeys: selected },
      });
      setCode("");
      setName("");
      setDescription("");
      setSelected([]);
      setNotice("نقش ایجاد شد.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function update(role: Role, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    const keys = data.getAll("permission").map(String);
    try {
      await apiRequest(`/api/tenant/roles/${role.id}`, {
        method: "PATCH",
        body: {
          name: String(data.get("name")),
          description: String(data.get("description")),
          permissionKeys: keys,
        },
      });
      setNotice("نقش به‌روزرسانی شد.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: Role) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/tenant/roles/${role.id}`, { method: "DELETE" });
      setNotice("نقش حذف شد.");
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
      {canCreate && (
        <form className="card card-pad" onSubmit={create}>
          <h2 className="card-title">نقش سفارشی</h2>
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="role-code">
                شناسه
              </label>
              <input
                className="input mono"
                id="role-code"
                required
                minLength={2}
                maxLength={80}
                pattern="[a-z][a-z0-9_-]{1,79}"
                value={code}
                onChange={(event) => setCode(event.target.value.toLowerCase())}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="role-name">
                نام
              </label>
              <input
                className="input"
                id="role-name"
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field field-full">
              <label className="label" htmlFor="role-description">
                توضیح
              </label>
              <input
                className="input"
                id="role-description"
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="section">
            <strong className="label">دسترسی‌ها</strong>
            <div className="permission-groups">
              {permissionGroups.map(([module, group]) => (
                <fieldset className="permission-group" key={module}>
                  <legend className="permission-group-title">
                    {MODULE_LABELS[module] ?? module}
                  </legend>
                  {group.map((permission) => (
                    <label className="check-row" key={permission.key}>
                      <span className="check-label">
                        <input
                          type="checkbox"
                          checked={selected.includes(permission.key)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, permission.key]
                                : current.filter(
                                    (key) => key !== permission.key,
                                  ),
                            )
                          }
                        />
                        {permissionLabel(permission)}
                      </span>
                      <span className="permission-key mono">
                        {permission.high_risk && (
                          <span className="badge badge-red">دسترسی پرخطر</span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "در حال ذخیره…" : "ایجاد نقش"}
            </button>
          </div>
        </form>
      )}
      <div className="grid grid-2">
        {roles.map((role) => (
          <article className="card card-pad" key={role.id}>
            <div className="section-header">
              <div>
                <h2>{roleLabel(role.code, role.name)}</h2>
              </div>
              <span className="badge badge-gray">
                {role.is_system ? "سیستمی" : "سفارشی"}
              </span>
            </div>
            {!role.is_system && <p className="muted">{role.description}</p>}
            <p className="hint">
              {role.user_count} کاربر · {role.permission_keys.length} دسترسی
            </p>
            <div className="check-row" style={{ flexWrap: "wrap" }}>
              {role.permission_keys.map((key) => (
                <span className="badge badge-gray" key={key}>
                  {permissionLabel(
                    permissions.find(
                      (permission) => permission.key === key,
                    ) ?? {
                      key,
                      module: key.split(".")[0] ?? "",
                      name: "",
                      high_risk: false,
                    },
                  )}
                </span>
              ))}
            </div>
            {!role.is_system && canUpdate && (
              <details className="section">
                <summary className="link">ویرایش نقش</summary>
                <form onSubmit={(event) => void update(role, event)}>
                  <div className="field">
                    <label className="label" htmlFor={`role-name-${role.id}`}>
                      نام
                    </label>
                    <input
                      className="input"
                      id={`role-name-${role.id}`}
                      name="name"
                      required
                      minLength={2}
                      maxLength={120}
                      defaultValue={role.name}
                    />
                  </div>
                  <div className="field">
                    <label
                      className="label"
                      htmlFor={`role-description-${role.id}`}
                    >
                      توضیح
                    </label>
                    <input
                      className="input"
                      id={`role-description-${role.id}`}
                      name="description"
                      maxLength={500}
                      defaultValue={role.description}
                    />
                  </div>
                  <div className="permission-groups">
                    {permissionGroups.map(([module, group]) => (
                      <fieldset className="permission-group" key={module}>
                        <legend className="permission-group-title">
                          {MODULE_LABELS[module] ?? module}
                        </legend>
                        {group.map((permission) => (
                          <label className="check-row" key={permission.key}>
                            <span className="check-label">
                              <input
                                type="checkbox"
                                name="permission"
                                value={permission.key}
                                defaultChecked={role.permission_keys.includes(
                                  permission.key,
                                )}
                              />
                              {permissionLabel(permission)}
                            </span>
                            <span className="permission-key mono">
                              {permission.high_risk && (
                                <span className="badge badge-red">
                                  دسترسی پرخطر
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-small"
                      disabled={busy}
                    >
                      ذخیره تغییرها
                    </button>
                    {canDelete && (
                      <button
                        className="btn btn-danger btn-small"
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(role)}
                      >
                        حذف نقش
                      </button>
                    )}
                  </div>
                </form>
              </details>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
