"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Globe2, Copy, MoreHorizontal, ShieldCheck } from "lucide-react";
import { AdminButton, AdminDialog } from "./admin-ui";
import { apiRequest } from "./api-client";

export type DomainView = {
  id: string;
  hostname: string;
  type: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
};
type Challenge = {
  recordName: string;
  recordValue: string;
  recordType: string;
  expiresAt: string;
};
export function domainInputValid(value: string): boolean {
  return (
    value.length <= 253 &&
    !/[\s:/@?#\\%,]/.test(value) &&
    value.includes(".") &&
    !/^\d+(\.\d+){3}$/.test(value) &&
    value
      .split(".")
      .every(
        (label) =>
          /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label) &&
          label.length <= 63,
      )
  );
}
function safeDomainError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("already registered"))
    return "این دامنه قبلاً ثبت شده است.";
  if (message.includes("expired"))
    return "اعتبار رکورد تمام شده است؛ رکورد جدید دریافت کنید.";
  if (message.includes("does not match"))
    return "هنوز تایید نشده؛ رکورد TXT را بررسی کنید و پس از انتشار دوباره تلاش کنید.";
  if (message.includes("DNS verification"))
    return "خطا در بررسی DNS؛ رکورد هنوز در دسترس نیست. بعداً دوباره تلاش کنید.";
  if (message.includes("primary"))
    return "برای حذف، ابتدا یک دامنه تاییدشده دیگر را اصلی کنید.";
  if (message.includes("feature") || message.includes("limit"))
    return "دامنه اختصاصی در طرح مجموعه فعال نیست یا ظرفیت آن تکمیل شده است.";
  return "درخواست انجام نشد. نام دامنه و دسترسی خود را بررسی کنید و دوباره تلاش کنید.";
}

export function TenantDomains({
  tenantId,
  domains,
  enabled,
  active,
}: {
  tenantId: string;
  domains: DomainView[];
  enabled: boolean;
  active: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(domains);
  const [modal, setModal] = useState<
    "add" | "dns" | "primary" | "delete" | null
  >(null);
  const [selected, setSelected] = useState<DomainView | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setItems(domains), [domains]);
  const base = `/api/platform/tenants/${tenantId}/domains`;
  useEffect(() => {
    const draft = sessionStorage.getItem("eventos-domain-draft");
    if (!draft) return;
    let intent: { tenantId?: string; hostname?: string };
    try {
      intent = JSON.parse(draft);
    } catch {
      sessionStorage.removeItem("eventos-domain-draft");
      return;
    }
    if (
      intent.tenantId !== tenantId ||
      !intent.hostname ||
      !domainInputValid(intent.hostname)
    )
      return;
    sessionStorage.removeItem("eventos-domain-draft");
    const requestedHost = intent.hostname;
    setBusy(true);
    void apiRequest<{ domain: DomainView; verification: Challenge }>(base, {
      method: "POST",
      body: { hostname: requestedHost },
    })
      .then(async (result) => {
        setSelected(result.domain);
        setChallenge(result.verification);
        setModal("dns");
        const updated = await apiRequest<{ domains: DomainView[] }>(
          `/api/platform/tenants/${tenantId}`,
        );
        setItems(updated.domains);
        router.refresh();
      })
      .catch((cause) => {
        setHostname(requestedHost);
        setModal("add");
        setError(safeDomainError(cause));
      })
      .finally(() => setBusy(false));
  }, [tenantId, base, router]);
  function open(kind: typeof modal, domain: DomainView | null = null) {
    setError("");
    setNotice("");
    setSelected(domain);
    setModal(kind);
  }
  function close() {
    if (!busy) {
      setModal(null);
      setChallenge(null);
      setError("");
    }
  }
  async function refresh() {
    const result = await apiRequest<{ domains: DomainView[] }>(
      `/api/platform/tenants/${tenantId}`,
    );
    setItems(result.domains);
    router.refresh();
  }
  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (cause) {
      setError(safeDomainError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!domainInputValid(hostname)) {
      setError("فقط نام دامنه را بدون آدرس، مسیر یا پورت وارد کنید.");
      return;
    }
    await perform(async () => {
      const result = await apiRequest<{
        domain: DomainView;
        verification: Challenge;
      }>(base, { method: "POST", body: { hostname } });
      setSelected(result.domain);
      setChallenge(result.verification);
      setHostname("");
      setModal("dns");
      await refresh();
    });
  }
  async function verify(domain: DomainView) {
    await perform(async () => {
      await apiRequest(`${base}/${domain.id}/verify`, { method: "POST" });
      await refresh();
      setNotice("تایید شد؛ مالکیت دامنه با موفقیت تایید شد.");
      setModal(null);
      setChallenge(null);
    });
  }
  async function rotate(domain: DomainView) {
    open("dns", domain);
    await perform(async () => {
      setChallenge(
        await apiRequest<Challenge>(`${base}/${domain.id}/verification`, {
          method: "POST",
        }),
      );
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("کپی شد");
    } catch {
      setError("کپی انجام نشد؛ مقدار را انتخاب و کپی کنید.");
    }
  }
  async function confirm() {
    if (!selected) return;
    await perform(async () => {
      await apiRequest(
        `${base}/${selected.id}${modal === "primary" ? "/primary" : ""}`,
        { method: modal === "primary" ? "POST" : "DELETE" },
      );
      await refresh();
      setModal(null);
      setNotice(
        modal === "primary" ? "دامنه اصلی تغییر کرد." : "دامنه حذف شد.",
      );
    });
  }
  const feedback = (
    <>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
    </>
  );
  return (
    <section
      className="card card-pad domain-section"
      aria-label="دامنه‌های مجموعه"
      dir="rtl"
      id="tenant-domains"
    >
      <div className="domain-heading">
        <div>
          <span className="eyebrow">آدرس و هویت مجموعه</span>
          <h2>دامنه‌های مجموعه</h2>
          <p className="muted">
            دامنه‌های این بخش مربوط به آدرس اختصاصی خود مجموعه هستند.
          </p>
        </div>
        <AdminButton
          tone="primary"
          icon="create"
          disabled={busy || !enabled}
          onClick={() => open("add")}
        >
          افزودن دامنه
        </AdminButton>
      </div>
      {!modal && feedback}
      {!enabled && (
        <p className="notice">
          برای اتصال دامنه، قابلیت دامنه اختصاصی را در طرح مجموعه فعال کنید.
        </p>
      )}
      {!items.some((item) => item.type === "CUSTOM") && (
        <div className="domain-empty">
          <Globe2 size={30} aria-hidden="true" />
          <strong>دامنه اختصاصی ثبت نشده است</strong>
          <p>برای استفاده از آدرس اختصاصی مجموعه، دامنه خود را متصل کنید.</p>
        </div>
      )}
      <div className="domain-list">
        {items.map((item) => (
          <article
            className="domain-card"
            key={item.id}
            aria-label={item.hostname}
          >
            <div className="domain-card-top">
              <div className="domain-address">
                <Globe2 size={20} aria-hidden="true" />
                <strong dir="ltr">{item.hostname}</strong>
              </div>
              <span
                className={`admin-status admin-status-${item.isPrimary ? "info" : "neutral"}`}
              >
                {item.isPrimary ? "دامنه اصلی" : "دامنه ثانویه"}
              </span>
            </div>
            <div className="domain-meta">
              <span>
                مالکیت:{" "}
                <span
                  className={`admin-status admin-status-${item.verifiedAt ? "success" : "warning"}`}
                >
                  {item.verifiedAt ? "تایید شده" : "در انتظار تایید"}
                </span>
              </span>
              <span>
                {item.type === "CUSTOM" ? "آدرس اختصاصی" : "آدرس پیش‌فرض مجموعه"}
              </span>
              <span>
                ثبت شده: {new Date(item.createdAt).toLocaleDateString("fa-IR")}
              </span>
              <span>
                وضعیت:{" "}
                {item.verifiedAt
                  ? active
                    ? "فعال"
                    : "مجموعه در دسترس نیست"
                  : "در انتظار تایید"}
              </span>
            </div>
            <div className="domain-actions">
              {item.type === "CUSTOM" && (
                <AdminButton disabled={busy} onClick={() => void verify(item)}>
                  {busy
                    ? "در حال بررسی..."
                    : item.verifiedAt
                      ? "بررسی مجدد"
                      : "بررسی تایید دامنه"}
                </AdminButton>
              )}
              {!item.verifiedAt && (
                <AdminButton disabled={busy} onClick={() => void rotate(item)}>
                  دریافت رکورد جدید
                </AdminButton>
              )}
              {item.verifiedAt && !item.isPrimary && (
                <AdminButton
                  tone="info"
                  disabled={busy}
                  onClick={() => open("primary", item)}
                >
                  اصلی کردن
                </AdminButton>
              )}
              {!item.isPrimary && (
                <details className="domain-menu">
                  <summary aria-label={`گزینه‌های ${item.hostname}`}>
                    <MoreHorizontal size={20} />
                  </summary>
                  <AdminButton
                    tone="danger"
                    icon="remove"
                    disabled={busy}
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      open("delete", item);
                    }}
                  >
                    حذف دامنه
                  </AdminButton>
                </details>
              )}
            </div>
          </article>
        ))}
      </div>
      <AdminDialog
        open={modal === "add"}
        title="افزودن دامنه"
        description="یک آدرس اختصاصی برای مجموعه متصل کنید."
        onClose={close}
      >
        <form onSubmit={add} className="domain-form">
          {feedback}
          <label className="label" htmlFor="domain-hostname">
            دامنه مجموعه
          </label>
          <input
            id="domain-hostname"
            className="input mono"
            dir="ltr"
            placeholder="event.example.ir"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            required
            maxLength={253}
            autoComplete="off"
            aria-describedby="domain-help"
          />
          <p id="domain-help" className="hint">
            فقط نام دامنه را وارد کنید، مانند: <bdi>event.example.ir</bdi>
          </p>
          <p className="notice">
            ثبت دامنه باعث فعال شدن آن نمی‌شود. ابتدا مالکیت را با رکورد DNS
            تایید کنید.
          </p>
          <div className="domain-actions">
            <AdminButton type="submit" tone="primary" disabled={busy}>
              {busy ? "در حال ثبت..." : "ثبت دامنه"}
            </AdminButton>
            <AdminButton type="button" disabled={busy} onClick={close}>
              انصراف
            </AdminButton>
          </div>
        </form>
      </AdminDialog>
      <AdminDialog
        open={modal === "dns"}
        title="تایید مالکیت دامنه"
        description={selected?.hostname ?? ""}
        onClose={close}
        footer={
          <AdminButton
            tone="primary"
            disabled={busy || !challenge}
            onClick={() => selected && void verify(selected)}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            {busy ? "در حال بررسی..." : "بررسی تایید دامنه"}
          </AdminButton>
        }
      >
        <div className="domain-dns">
          {feedback}
          <ol>
            <li>
              <strong>مرحله ۱</strong>
              <p>وارد پنل DNS دامنه شوید.</p>
            </li>
            <li>
              <strong>مرحله ۲</strong>
              <p>رکورد زیر را اضافه کنید.</p>
              {challenge ? (
                <>
                  <p>
                    <span className="hint">نوع رکورد: </span>
                    <strong dir="ltr">TXT</strong>
                  </p>
                  {[
                    ["نام / Host", challenge.recordName, "کپی نام"],
                    ["مقدار", challenge.recordValue, "کپی مقدار"],
                  ].map(([label, value, button]) => (
                    <div className="domain-dns-value" key={label}>
                      <span>{label}</span>
                      <code dir="ltr">{value}</code>
                      <AdminButton
                        type="button"
                        onClick={() => void copy(value ?? "")}
                      >
                        <Copy size={15} aria-hidden="true" />
                        {button}
                      </AdminButton>
                    </div>
                  ))}
                  <p className="hint">
                    اعتبار رکورد تا{" "}
                    {new Date(challenge.expiresAt).toLocaleString("fa-IR")}
                  </p>
                </>
              ) : (
                <p>در حال دریافت رکورد...</p>
              )}
            </li>
            <li>
              <strong>مرحله ۳</strong>
              <p>بعد از ذخیره DNS، تایید را بررسی کنید.</p>
            </li>
          </ol>
          <p className="notice">
            انتشار DNS ممکن است چند دقیقه تا چند ساعت زمان ببرد.
          </p>
        </div>
      </AdminDialog>
      <AdminDialog
        open={modal === "primary" || modal === "delete"}
        title={modal === "primary" ? "تغییر دامنه اصلی" : "حذف دامنه"}
        onClose={close}
        footer={
          <>
            <AdminButton disabled={busy} onClick={close}>
              انصراف
            </AdminButton>
            <AdminButton
              tone={modal === "delete" ? "danger" : "primary"}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? "در حال ذخیره..."
                : modal === "primary"
                  ? "تغییر دامنه اصلی"
                  : "حذف دامنه"}
            </AdminButton>
          </>
        }
      >
        {feedback}
        <p>
          {modal === "primary"
            ? "دامنه اصلی مجموعه به آدرس زیر تغییر خواهد کرد:"
            : "دامنه زیر حذف خواهد شد:"}
        </p>
        <p className="domain-confirm-host" dir="ltr">
          {selected?.hostname}
        </p>
        <p className="notice">
          {modal === "primary"
            ? "ممکن است کاربران برای این دامنه نیاز به ورود مجدد داشته باشند."
            : "بعد از حذف، EventOS دیگر درخواست‌های این دامنه را برای مجموعه نمی‌پذیرد."}
        </p>
      </AdminDialog>
    </section>
  );
}
