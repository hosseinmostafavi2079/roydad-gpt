"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminButton, AdminDialog } from "./admin-ui";

type Admin = {
  id: string;
  displayName: string;
  email: string;
  status: string;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  mfaEnabled: boolean;
  isCurrent: boolean;
};
type AdminList = { items: Admin[]; activeCount: number };
const statuses: Record<string, [string, string]> = {
  PENDING_ACTIVATION: ["در انتظار فعال‌سازی", "warning"],
  ACTIVE: ["فعال", "success"],
  REVOKED: ["غیرفعال‌شده", "neutral"],
};
const actions: Record<string, string> = {
  "activation/regenerate": "تولید مجدد کد فعال‌سازی",
  revoke: "غیرفعال‌کردن",
  reactivate: "فعال‌سازی مجدد",
  "sessions/revoke": "خروج از همه دستگاه‌ها",
};
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "medium",
        timeZone: "Asia/Tehran",
      }).format(new Date(value))
    : "—";
export function PlatformAdminsCenter() {
  const router = useRouter();
  const [data, setData] = useState<AdminList>({ items: [], activeCount: 0 }),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [create, setCreate] = useState(false),
    [code, setCode] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState<{ admin: Admin; action: string } | null>(
      null,
    );
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit manual reload generation.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/platform/admins?offset=${offset}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result.data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("دریافت فهرست مدیران ممکن نشد. دوباره تلاش کنید.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, refresh]);
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/platform/admins${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.error?.code === "CONFLICT"
            ? "ایمیل تکراری است یا حداقل یک مدیر فعال باید باقی بماند."
            : "عملیات انجام نشد. وضعیت مدیر و اطلاعات را بررسی کنید.",
        );
        return;
      }
      setCreate(false);
      setConfirm(null);
      if (result.data.activationCode) {
        setCode(result.data.activationCode);
        setCopied(false);
      } else setMessage("عملیات با موفقیت انجام شد.");
      if (
        confirm?.admin.isCurrent &&
        (confirm.action === "revoke" || confirm.action === "sessions/revoke")
      ) {
        router.replace("/sign-in");
        router.refresh();
        return;
      }
      setRefresh((value) => value + 1);
    } catch {
      setError("عملیات انجام نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="content platform-admins-center" dir="rtl">
      <div className="page-heading">
        <div>
          <div className="eyebrow">مدیریت پلتفرم</div>
          <h1 className="page-title">مدیران پلتفرم</h1>
          <p className="page-description">
            همه مدیران فعال دسترسی کامل مدیر ارشد دارند. افزودن حساب فقط از این
            بخش امکان‌پذیر است.
          </p>
        </div>
        <div className="admin-management-actions">
          <AdminButton
            disabled={loading || busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            بروزرسانی
          </AdminButton>
          <AdminButton
            tone="primary"
            icon="create"
            disabled={busy}
            onClick={() => {
              setError("");
              setCreate(true);
            }}
          >
            افزودن مدیر جدید
          </AdminButton>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">در حال دریافت مدیران...</p>}
      <section className="admin-management-list" aria-label="فهرست مدیران">
        {data.items.map((admin) => {
          const [label, tone] = statuses[admin.status] ?? [
            "وضعیت نامشخص",
            "neutral",
          ];
          const last = admin.status === "ACTIVE" && data.activeCount <= 1;
          return (
            <article className="card card-pad" key={admin.id}>
              <div className="admin-management-actions">
                <h2>{admin.displayName}</h2>
                <span className={`admin-status admin-status-${tone}`}>
                  {label}
                </span>
                {admin.isCurrent && (
                  <span className="admin-status admin-status-info">
                    حساب شما
                  </span>
                )}
              </div>
              <p dir="ltr" className="admin-management-email">
                {admin.email}
              </p>
              <dl className="admin-management-fields">
                <div>
                  <dt>تاریخ ایجاد</dt>
                  <dd>{date(admin.createdAt)}</dd>
                </div>
                <div>
                  <dt>فعال‌سازی</dt>
                  <dd>{date(admin.activatedAt)}</dd>
                </div>
                <div>
                  <dt>ورود دومرحله‌ای</dt>
                  <dd>{admin.mfaEnabled ? "ثبت‌شده" : "ثبت نشده"}</dd>
                </div>
              </dl>
              <div className="admin-management-actions">
                {(admin.status === "PENDING_ACTIVATION"
                  ? ["activation/regenerate", "revoke"]
                  : admin.status === "ACTIVE"
                    ? ["sessions/revoke", "revoke"]
                    : ["reactivate"]
                ).map((action) => (
                  <AdminButton
                    key={action}
                    tone={action === "revoke" ? "danger" : "neutral"}
                    disabled={busy || (action === "revoke" && last)}
                    onClick={() => {
                      setError("");
                      setConfirm({ admin, action });
                    }}
                  >
                    {actions[action]}
                  </AdminButton>
                ))}
              </div>
              {last && (
                <p className="hint">
                  حداقل یک مدیر فعال باید در پلتفرم باقی بماند.
                </p>
              )}
            </article>
          );
        })}
      </section>
      <div className="admin-management-actions" style={{ marginTop: 16 }}>
        <AdminButton
          disabled={loading || offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - 100))}
        >
          صفحه قبل
        </AdminButton>
        <AdminButton
          disabled={loading || data.items.length < 100 || offset >= 10000}
          onClick={() => setOffset((value) => value + 100)}
        >
          صفحه بعد
        </AdminButton>
      </div>
      <AdminDialog
        open={create}
        title="افزودن مدیر جدید"
        onClose={() => {
          if (!busy) setCreate(false);
        }}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(
              new FormData(event.currentTarget),
            );
            void mutate("", values);
          }}
        >
          <label className="field">
            نام مدیر
            <input
              className="input"
              name="displayName"
              required
              minLength={2}
              maxLength={120}
            />
          </label>
          <label className="field">
            ایمیل
            <input
              className="input"
              name="email"
              type="email"
              dir="ltr"
              required
              maxLength={320}
            />
          </label>
          <p className="hint">
            رمز عبور را مدیر جدید هنگام فعال‌سازی انتخاب می‌کند. ایمیلی ارسال
            نخواهد شد.
          </p>
          {error && <p role="alert">{error}</p>}
          <AdminButton type="submit" tone="primary" disabled={busy}>
            ایجاد حساب در انتظار فعال‌سازی
          </AdminButton>
        </form>
      </AdminDialog>
      <AdminDialog
        open={code !== null}
        title="کد فعال‌سازی یک‌بارمصرف"
        onClose={() => {
          setCode(null);
          setCopied(false);
        }}
      >
        <p>کد فعال‌سازی فقط همین یک بار نمایش داده می‌شود.</p>
        <output className="admin-activation-code" dir="ltr">
          {code}
        </output>
        <p className="hint">
          اعتبار: ۲۴ ساعت. کد قبلی پس از تولید مجدد معتبر نیست.
        </p>
        <ol style={{ paddingInlineStart: 24, listStyle: "decimal" }}>
          <li>کد را به‌صورت امن برای مدیر جدید ارسال کنید.</li>
          <li>
            مدیر صفحه{" "}
            <a className="link" href="/platform-activation">
              فعال‌سازی
            </a>{" "}
            را باز کند.
          </li>
          <li>ایمیل، کد و رمز عبور شخصی خود را وارد کند.</li>
          <li>پس از فعال‌سازی از صفحه ورود وارد شود.</li>
        </ol>
        <div className="admin-management-actions">
          <AdminButton
            onClick={() => {
              void navigator.clipboard
                .writeText(code ?? "")
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "کپی شد" : "کپی کد"}
          </AdminButton>
          <AdminButton
            onClick={() => {
              setCode(null);
              setCopied(false);
            }}
          >
            بستن
          </AdminButton>
        </div>
      </AdminDialog>
      <AdminDialog
        open={confirm !== null}
        title={
          confirm ? (actions[confirm.action] ?? "تأیید عملیات") : "تأیید عملیات"
        }
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        footer={
          <AdminButton
            tone="primary"
            disabled={busy}
            onClick={() => {
              if (confirm)
                void mutate(`/${confirm.admin.id}/${confirm.action}`, {});
            }}
          >
            تأیید
          </AdminButton>
        }
      >
        <p>{confirm?.admin.displayName}</p>
        <p>
          {confirm?.action === "sessions/revoke"
            ? "تمام نشست‌های این مدیر، شامل دستگاه فعلی او، باطل می‌شود."
            : confirm?.action === "revoke"
              ? "دسترسی این مدیر و تمام نشست‌ها و کدهای فعال‌سازی او لغو می‌شود."
              : confirm?.action === "activation/regenerate"
                ? "کد قبلی فوراً نامعتبر می‌شود. کد جدید فقط یک بار نمایش داده خواهد شد."
                : "نشست‌های قبلی بازگردانده نمی‌شود. حساب باید دوباره وارد شود یا فعال‌سازی را تکمیل کند."}
        </p>
        {error && <p role="alert">{error}</p>}
      </AdminDialog>
    </main>
  );
}
