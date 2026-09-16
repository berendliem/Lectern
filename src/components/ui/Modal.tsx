"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // The element that opened the dialog gets focus back when it closes;
  // otherwise focus drops to <body> and a keyboard user starts over from the
  // top of the page. The dialog places focus itself rather than relying on a
  // child's autoFocus: autoFocus lands before any effect runs, so by then
  // activeElement is already the panel's own input and the opener is lost.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (items.find((el) => el.getAttribute("aria-label") !== "Close") ?? items[0])?.focus();
    return () => opener?.focus?.();
  }, [open]);

  // `onClose` is usually an inline arrow, so it lives in a ref: keying the
  // listener on it would tear it down and re-add it on every keystroke typed
  // into the dialog's own form.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      const items = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl shadow-zinc-900/10"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <h2 id={titleId} className="mb-4 text-base font-semibold text-ink">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
  );
}
