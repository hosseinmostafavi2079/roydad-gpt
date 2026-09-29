"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function MobileDrawer({
  brand,
  navigation,
  account,
}: {
  brand: string;
  navigation: React.ReactNode;
  account: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const opener = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      setOpen(false);
    }
  });
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        opener.current?.focus();
      }
      if (event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),input:not([disabled])",
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    function onNavigation(event: MouseEvent) {
      if ((event.target as Element).closest("a[href]")) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    navigationRef.current?.addEventListener("click", onNavigation);
    const currentNavigation = navigationRef.current;
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
      currentNavigation?.removeEventListener("click", onNavigation);
    };
  }, [open]);

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="mobile-menu-button"
        aria-label="باز کردن منو"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onClick={() => setOpen(true)}
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      {open && (
        <div className="drawer-layer">
          <button
            className="drawer-backdrop"
            type="button"
            aria-label="بستن منو"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={panelRef}
            id="mobile-navigation"
            className="drawer-panel"
            aria-label="منوی برنامه"
            aria-modal="true"
            role="dialog"
          >
            <div className="drawer-heading">
              <strong>{brand}</strong>
              <button
                ref={closeButton}
                className="icon-button"
                type="button"
                aria-label="بستن منو"
                onClick={() => {
                  setOpen(false);
                  opener.current?.focus();
                }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="drawer-navigation" ref={navigationRef}>
              {navigation}
            </div>
            <div className="drawer-account">{account}</div>
          </aside>
        </div>
      )}
    </>
  );
}
