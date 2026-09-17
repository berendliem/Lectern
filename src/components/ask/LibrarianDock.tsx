"use client";

import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import { BookOpen, X } from "lucide-react";
import { LibraryChat } from "./LibraryChat";

/**
 * The librarian: the ask-all chat, reachable from any page through a button
 * in the bottom-right corner. It is the same thread as /ask, so it stays off
 * that page rather than showing the conversation twice.
 */
export function LibrarianDock() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (pathname === "/ask") return null;

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-labelledby={titleId}
          className="fixed bottom-20 right-4 z-40 flex h-[min(32rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line bg-surface p-3 shadow-xl shadow-zinc-900/10"
        >
          <div className="mb-2 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-ink" strokeWidth={2.2} />
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              Librarian
            </h2>
            <span className="text-[11.5px] text-muted-2">every course</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-md p-1 text-muted-2 transition-colors hover:bg-surface-3 hover:text-ink-soft"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <LibraryChat compact />
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close librarian" : "Ask the librarian"}
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-brand transition-opacity hover:opacity-95"
      >
        {open ? <X className="h-5 w-5" strokeWidth={2.2} /> : <BookOpen className="h-5 w-5" strokeWidth={2.2} />}
      </button>
    </>
  );
}
