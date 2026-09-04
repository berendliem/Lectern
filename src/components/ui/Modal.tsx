"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

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
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl shadow-zinc-900/10">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <h2 className="mb-4 text-base font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  );
}
