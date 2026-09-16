"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
  );
}

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // "/" focuses search, as on GitHub and most docs sites. Only when the key
  // would otherwise go nowhere: typing a slash into a chat box must still
  // type a slash, and a dialog's focus trap must not be pulled out from under
  // it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" strokeWidth={2} />
      <input
        ref={inputRef}
        placeholder="Search notes, transcripts, flashcards…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-lg border border-transparent bg-surface-3 py-1.5 pl-9 pr-8 text-sm text-ink placeholder:text-muted-2 transition-colors focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-gold"
      />
      {!query && !focused && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-surface px-1.5 font-sans text-[11px] text-muted-2"
        >
          /
        </kbd>
      )}
    </form>
  );
}
