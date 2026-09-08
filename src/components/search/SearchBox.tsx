"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" strokeWidth={2} />
      <input
        placeholder="Search notes, transcripts, flashcards…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-transparent bg-surface-3 py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-muted-2 transition-colors focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-gold"
      />
    </form>
  );
}
