"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  Check,
  Eye,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

type ActionTone =
  | "primary"
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "neutral";
const icons = {
  create: Plus,
  edit: Pencil,
  view: Eye,
  confirm: Check,
  remove: Trash2,
  close: X,
};

export function AdminButton({
  tone = "neutral",
  icon,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  icon?: keyof typeof icons;
}) {
  const Icon = icon ? icons[icon] : null;
  return (
    <button
      className={`admin-action admin-action-${tone} ${className}`}
      {...props}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const value: Record<string, [string, string]> = {
    ACTIVE: ["فعال", "success"],
    SUSPENDED: ["تعلیق‌شده", "warning"],
    DISABLED: ["غیرفعال", "neutral"],
    INVITED: ["دعوت‌شده", "info"],
    DRAFT: ["پیش‌نویس", "neutral"],
    PUBLISHED: ["منتشرشده", "success"],
    CONFIRMED: ["تأییدشده", "success"],
    PENDING: ["در انتظار", "warning"],
    AWAITING_PAYMENT: ["در انتظار پرداخت", "info"],
    WAITLISTED: ["فهرست انتظار", "neutral"],
    CANCELLED: ["لغوشده", "danger"],
    COMPLETED: ["تکمیل‌شده", "success"],
    FAILED: ["ناموفق", "danger"],
    HEALTHY: ["سالم", "success"],
    ARCHIVED: ["بایگانی‌شده", "neutral"],
    PRIVATE: ["خصوصی", "info"],
    SCHEDULED: ["برنامه‌ریزی‌شده", "info"],
  };
  const [label, tone] = value[status] ?? [status, "neutral"];
  return <span className={`admin-status admin-status-${tone}`}>{label}</span>;
}

export function AdminDialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else if (!open) {
      if (dialog.open) dialog.close();
      returnFocus.current?.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`admin-dialog ${wide ? "admin-dialog-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="admin-dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <AdminButton
          type="button"
          icon="close"
          aria-label="بستن"
          onClick={onClose}
        />
      </header>
      <div className="admin-dialog-body">{children}</div>
      {footer && <footer className="admin-dialog-footer">{footer}</footer>}
    </dialog>
  );
}

export function ConfirmationDialog({
  open,
  title,
  description,
  busy,
  onClose,
  onConfirm,
  confirmText = "تأیید",
}: {
  open: boolean;
  title: string;
  description: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmText?: string;
}) {
  return (
    <AdminDialog
      open={open}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <AdminButton type="button" onClick={onClose} disabled={busy}>
            انصراف
          </AdminButton>
          <AdminButton
            type="button"
            tone="danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "در حال انجام..." : confirmText}
          </AdminButton>
        </>
      }
    >
      <div className="admin-confirmation-message">
        <TriangleAlert size={22} aria-hidden="true" />
        <p>{description}</p>
      </div>
    </AdminDialog>
  );
}
